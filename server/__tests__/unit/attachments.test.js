const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Mock auth middleware
jest.mock('../../src/middleware/auth', () => {
  return (req, res, next) => {
    if (req.headers['x-test-user-id']) {
      req.user = {
        id: req.headers['x-test-user-id'],
        email: 'test@test.com',
        displayName: 'Test User',
      };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'No token provided', statusCode: 401 });
  };
});

// Mock Prisma
jest.mock('../../src/config/database', () => ({
  task: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  projectMember: {
    findUnique: jest.fn(),
  },
  taskAttachment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  taskComment: {
    create: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
}));

// Mock notification service
jest.mock('../../src/services/notificationService', () => ({
  notifyTaskAssigned: jest.fn().mockResolvedValue(undefined),
  notifyTaskComment: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require('../../src/config/database');

// Setup upload directory for tests
const TEST_UPLOAD_DIR = path.join(__dirname, '../test-uploads');

function createApp() {
  process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;
  const app = express();
  app.use(express.json());
  const taskRoutes = require('../../src/routes/tasks');
  app.use('/tasks', taskRoutes);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      error: err.name || 'Error',
      message: err.message || 'Something went wrong',
      statusCode: err.statusCode || 500,
    });
  });
  return app;
}

describe('Task Attachments - Unit Tests', () => {
  let app;
  const userId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();

  beforeAll(() => {
    if (!fs.existsSync(TEST_UPLOAD_DIR)) {
      fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
    app = createApp();
  });

  afterAll(() => {
    // Clean up test upload dir
    if (fs.existsSync(TEST_UPLOAD_DIR)) {
      const files = fs.readdirSync(TEST_UPLOAD_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_UPLOAD_DIR, file));
      }
      fs.rmdirSync(TEST_UPLOAD_DIR);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /tasks/:id/attachments', () => {
    it('should upload a file with allowed extension and store mimeType', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: taskId,
        projectId,
        title: 'Test Task',
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId,
        projectId,
        role: 'member',
      });

      prisma.taskAttachment.create.mockResolvedValue({
        id: attachmentId,
        taskId,
        filename: 'test-document.pdf',
        filepath: '1234567890-abc123.pdf',
        filesize: 1024,
        mimeType: 'application/pdf',
        uploadedBy: userId,
        uploader: { id: userId, displayName: 'Test User' },
      });

      const res = await request(app)
        .post(`/tasks/${taskId}/attachments`)
        .set('x-test-user-id', userId)
        .attach('file', Buffer.from('fake pdf content'), 'test-document.pdf');

      expect(res.status).toBe(201);
      expect(res.body.mimeType).toBe('application/pdf');
      expect(res.body.filename).toBe('test-document.pdf');
      expect(prisma.taskAttachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mimeType: expect.any(String),
            taskId,
            uploadedBy: userId,
          }),
        })
      );
    });

    it('should reject files with disallowed extensions', async () => {
      const res = await request(app)
        .post(`/tasks/${taskId}/attachments`)
        .set('x-test-user-id', userId)
        .attach('file', Buffer.from('malicious content'), 'malware.exe');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('File type not allowed');
    });

    it('should reject files exceeding 10MB', async () => {
      // Create a buffer slightly over 10MB
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'x');

      const res = await request(app)
        .post(`/tasks/${taskId}/attachments`)
        .set('x-test-user-id', userId)
        .attach('file', largeBuffer, 'large-file.pdf');

      expect(res.status).toBe(413);
      expect(res.body.message).toContain('10MB');
    });

    it('should return 403 for non-project members', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: taskId,
        projectId,
        title: 'Test Task',
      });

      prisma.projectMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`/tasks/${taskId}/attachments`)
        .set('x-test-user-id', userId)
        .attach('file', Buffer.from('content'), 'test.pdf');

      expect(res.status).toBe(403);
    });

    it('should return 400 for invalid UUID param', async () => {
      const res = await request(app)
        .post('/tasks/not-a-uuid/attachments')
        .set('x-test-user-id', userId)
        .attach('file', Buffer.from('content'), 'test.pdf');

      expect(res.status).toBe(400);
    });

    it('should generate unique filename with timestamp-uuid format', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: taskId,
        projectId,
        title: 'Test Task',
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId,
        projectId,
        role: 'member',
      });

      prisma.taskAttachment.create.mockImplementation(({ data }) => {
        // Verify the filepath matches expected format
        const filepathPattern = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.\w+$/i;
        expect(data.filepath).toMatch(filepathPattern);
        expect(data.mimeType).toBeDefined();
        return Promise.resolve({
          id: attachmentId,
          ...data,
          uploader: { id: userId, displayName: 'Test User' },
        });
      });

      const res = await request(app)
        .post(`/tasks/${taskId}/attachments`)
        .set('x-test-user-id', userId)
        .attach('file', Buffer.from('test content'), 'my-document.txt');

      expect(res.status).toBe(201);
    });
  });

  describe('GET /tasks/attachments/:id/download', () => {
    it('should return 403 for non-members', async () => {
      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: 'test-file.pdf',
        filename: 'original.pdf',
        mimeType: 'application/pdf',
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/tasks/attachments/${attachmentId}/download`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Not a project member');
    });

    it('should return 404 for non-existent attachment', async () => {
      prisma.taskAttachment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/tasks/attachments/${attachmentId}/download`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(404);
    });

    it('should serve file with correct Content-Type and Content-Disposition', async () => {
      // Create a test file
      const testFilename = `${Date.now()}-${crypto.randomUUID()}.txt`;
      const testFilePath = path.join(TEST_UPLOAD_DIR, testFilename);
      fs.writeFileSync(testFilePath, 'Hello World');

      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: testFilename,
        filename: 'my-document.txt',
        mimeType: 'text/plain',
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId,
        projectId,
        role: 'member',
      });

      const res = await request(app)
        .get(`/tasks/attachments/${attachmentId}/download`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/plain');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('my-document.txt');

      // Cleanup
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    });

    it('should return 400 for invalid UUID param', async () => {
      const res = await request(app)
        .get('/tasks/attachments/not-a-uuid/download')
        .set('x-test-user-id', userId);

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /tasks/attachments/:id', () => {
    it('should allow uploader to delete', async () => {
      const testFilename = `${Date.now()}-${crypto.randomUUID()}.txt`;
      const testFilePath = path.join(TEST_UPLOAD_DIR, testFilename);
      fs.writeFileSync(testFilePath, 'to be deleted');

      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: testFilename,
        filename: 'original.txt',
        uploadedBy: userId,
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId,
        projectId,
        role: 'member',
      });

      prisma.taskAttachment.delete.mockResolvedValue({});

      const res = await request(app)
        .delete(`/tasks/attachments/${attachmentId}`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Attachment deleted');
      expect(prisma.taskAttachment.delete).toHaveBeenCalled();
    });

    it('should allow admin to delete', async () => {
      const adminId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();

      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: 'some-file.txt',
        filename: 'original.txt',
        uploadedBy: otherUserId, // uploaded by someone else
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId: adminId,
        projectId,
        role: 'admin',
      });

      prisma.taskAttachment.delete.mockResolvedValue({});

      const res = await request(app)
        .delete(`/tasks/attachments/${attachmentId}`)
        .set('x-test-user-id', adminId);

      expect(res.status).toBe(200);
    });

    it('should return 403 for non-uploader non-admin', async () => {
      const otherUserId = crypto.randomUUID();

      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: 'some-file.txt',
        filename: 'original.txt',
        uploadedBy: otherUserId, // uploaded by someone else
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue({
        userId,
        projectId,
        role: 'member', // not admin
      });

      const res = await request(app)
        .delete(`/tasks/attachments/${attachmentId}`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('uploader or admin');
    });

    it('should return 403 for non-project members', async () => {
      prisma.taskAttachment.findUnique.mockResolvedValue({
        id: attachmentId,
        filepath: 'some-file.txt',
        filename: 'original.txt',
        uploadedBy: userId,
        task: { projectId },
      });

      prisma.projectMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/tasks/attachments/${attachmentId}`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent attachment', async () => {
      prisma.taskAttachment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/tasks/attachments/${attachmentId}`)
        .set('x-test-user-id', userId);

      expect(res.status).toBe(404);
    });
  });
});
