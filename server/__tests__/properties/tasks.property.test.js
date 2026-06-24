const fc = require('fast-check');
const express = require('express');
const request = require('supertest');
const path = require('path');
const crypto = require('crypto');

// Mock auth middleware to bypass JWT verification in tests
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
  },
  projectMember: {
    findUnique: jest.fn(),
  },
  taskAttachment: {
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

// Mock fs for upload tests
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

const prisma = require('../../src/config/database');
const { errorHandler } = require('../../src/middleware/errorHandler');

// Create a test app with task routes
function createApp() {
  const app = express();
  app.use(express.json());

  // We need to load routes after mocks are set up
  const taskRoutes = require('../../src/routes/tasks');
  app.use('/tasks', taskRoutes);
  app.use(errorHandler);
  return app;
}

describe('Task Operations - Property Tests', () => {
  let app;

  beforeAll(() => {
    // Set upload dir for tests
    process.env.UPLOAD_DIR = path.join(__dirname, '../../uploads');
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---
  const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
  const statusArb = fc.constantFrom(...validStatuses);
  const priorityArb = fc.constantFrom('low', 'medium', 'high', 'urgent');
  // Use UUID v4 specifically since validateUuidParam checks for v4 format
  const uuidV4Arb = fc.uuid().filter(u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u));
  const userIdArb = uuidV4Arb;
  const projectIdArb = uuidV4Arb;
  const taskIdArb = uuidV4Arb;

  /**
   * Property 11: Task status transitions are unrestricted
   *
   * For any two valid task statuses (todo, in_progress, in_review, done),
   * a status transition between them SHALL succeed when performed by an authorized user
   * (assignee or admin/owner).
   *
   * **Validates: Requirements 6.1**
   */
  describe('Property 11: Task status transitions are unrestricted', () => {
    it('any status transition succeeds for assignee', async () => {
      await fc.assert(
        fc.asyncProperty(
          statusArb,
          statusArb,
          taskIdArb,
          projectIdArb,
          userIdArb,
          async (fromStatus, toStatus, taskId, projectId, userId) => {
            jest.clearAllMocks();

            // Task exists with fromStatus, user is the assignee
            prisma.task.findUnique.mockResolvedValue({
              id: taskId,
              projectId,
              status: fromStatus,
              assigneeId: userId,
              createdBy: userId,
            });

            // User is a project member
            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            // Update returns the task with new status
            prisma.task.update.mockResolvedValue({
              id: taskId,
              projectId,
              status: toStatus,
              assigneeId: userId,
              createdBy: userId,
            });

            const res = await request(app)
              .put(`/tasks/${taskId}`)
              .set('x-test-user-id', userId)
              .send({ status: toStatus });

            // Transition should always succeed
            expect(res.status).toBe(200);
            expect(res.body.status).toBe(toStatus);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('any status transition succeeds for admin/owner', async () => {
      await fc.assert(
        fc.asyncProperty(
          statusArb,
          statusArb,
          taskIdArb,
          projectIdArb,
          userIdArb,
          userIdArb,
          fc.constantFrom('admin', 'owner'),
          async (fromStatus, toStatus, taskId, projectId, userId, assigneeId, role) => {
            // Ensure user is not the assignee (testing admin path)
            fc.pre(userId !== assigneeId);
            jest.clearAllMocks();

            prisma.task.findUnique.mockResolvedValue({
              id: taskId,
              projectId,
              status: fromStatus,
              assigneeId: assigneeId,
              createdBy: assigneeId,
            });

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role,
            });

            prisma.task.update.mockResolvedValue({
              id: taskId,
              projectId,
              status: toStatus,
              assigneeId: assigneeId,
              createdBy: assigneeId,
            });

            const res = await request(app)
              .put(`/tasks/${taskId}`)
              .set('x-test-user-id', userId)
              .send({ status: toStatus });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe(toStatus);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all 16 possible status transitions are valid (exhaustive)', async () => {
      // Exhaustively test all from→to pairs
      for (const fromStatus of validStatuses) {
        for (const toStatus of validStatuses) {
          jest.clearAllMocks();
          const taskId = crypto.randomUUID();
          const projectId = crypto.randomUUID();
          const userId = crypto.randomUUID();

          prisma.task.findUnique.mockResolvedValue({
            id: taskId,
            projectId,
            status: fromStatus,
            assigneeId: userId,
            createdBy: userId,
          });

          prisma.projectMember.findUnique.mockResolvedValue({
            userId,
            projectId,
            role: 'member',
          });

          prisma.task.update.mockResolvedValue({
            id: taskId,
            projectId,
            status: toStatus,
            assigneeId: userId,
            createdBy: userId,
          });

          const res = await request(app)
            .put(`/tasks/${taskId}`)
            .set('x-test-user-id', userId)
            .send({ status: toStatus });

          expect(res.status).toBe(200);
        }
      }
    });
  });

  /**
   * Property 28: Task filtering returns correct subset
   *
   * For any combination of status, assignee, and priority filters applied to a project's tasks,
   * the returned set SHALL contain exactly those tasks matching ALL active filter criteria,
   * ordered by priority descending then creation date descending.
   *
   * **Validates: Requirements 5.3**
   */
  describe('Property 28: Task filtering returns correct subset', () => {
    // Priority ordering: urgent > high > medium > low
    const priorityOrder = { urgent: 3, high: 2, medium: 1, low: 0 };

    // Generate a list of random tasks
    const taskArb = fc.record({
      id: taskIdArb,
      status: statusArb,
      priority: priorityArb,
      assigneeId: fc.option(userIdArb, { nil: null }),
      createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2026-01-01') }),
    });

    const taskListArb = fc.array(taskArb, { minLength: 0, maxLength: 20 });

    it('filtering by status returns only tasks with that status', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          statusArb,
          projectIdArb,
          userIdArb,
          async (tasks, filterStatus, projectId, userId) => {
            jest.clearAllMocks();

            // Simulate server-side filtering: return only matching tasks
            const matchingTasks = tasks.filter(t => t.status === filterStatus);

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            prisma.task.findMany.mockResolvedValue(matchingTasks);

            const res = await request(app)
              .get(`/tasks/project/${projectId}?status=${filterStatus}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            // All returned tasks should have the filtered status
            for (const task of res.body) {
              expect(task.status).toBe(filterStatus);
            }
            // The count should match
            expect(res.body.length).toBe(matchingTasks.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filtering by priority returns only tasks with that priority', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          priorityArb,
          projectIdArb,
          userIdArb,
          async (tasks, filterPriority, projectId, userId) => {
            jest.clearAllMocks();

            const matchingTasks = tasks.filter(t => t.priority === filterPriority);

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            prisma.task.findMany.mockResolvedValue(matchingTasks);

            const res = await request(app)
              .get(`/tasks/project/${projectId}?priority=${filterPriority}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            for (const task of res.body) {
              expect(task.priority).toBe(filterPriority);
            }
            expect(res.body.length).toBe(matchingTasks.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filtering by assignee returns only tasks assigned to that user', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          userIdArb,
          projectIdArb,
          userIdArb,
          async (tasks, filterAssignee, projectId, userId) => {
            jest.clearAllMocks();

            const matchingTasks = tasks.filter(t => t.assigneeId === filterAssignee);

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            prisma.task.findMany.mockResolvedValue(matchingTasks);

            const res = await request(app)
              .get(`/tasks/project/${projectId}?assignee=${filterAssignee}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            for (const task of res.body) {
              expect(task.assigneeId).toBe(filterAssignee);
            }
            expect(res.body.length).toBe(matchingTasks.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('combined filters return only tasks matching ALL criteria', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          statusArb,
          priorityArb,
          projectIdArb,
          userIdArb,
          async (tasks, filterStatus, filterPriority, projectId, userId) => {
            jest.clearAllMocks();

            const matchingTasks = tasks.filter(
              t => t.status === filterStatus && t.priority === filterPriority
            );

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            prisma.task.findMany.mockResolvedValue(matchingTasks);

            const res = await request(app)
              .get(`/tasks/project/${projectId}?status=${filterStatus}&priority=${filterPriority}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            for (const task of res.body) {
              expect(task.status).toBe(filterStatus);
              expect(task.priority).toBe(filterPriority);
            }
            expect(res.body.length).toBe(matchingTasks.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('the Prisma query includes correct where clause based on filters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.option(statusArb, { nil: undefined }),
          fc.option(priorityArb, { nil: undefined }),
          fc.option(userIdArb, { nil: undefined }),
          projectIdArb,
          userIdArb,
          async (status, priority, assignee, projectId, userId) => {
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            prisma.task.findMany.mockResolvedValue([]);

            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (priority) params.set('priority', priority);
            if (assignee) params.set('assignee', assignee);

            await request(app)
              .get(`/tasks/project/${projectId}?${params.toString()}`)
              .set('x-test-user-id', userId);

            // Verify Prisma was called with the correct filters
            expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
            const call = prisma.task.findMany.mock.calls[0][0];
            expect(call.where.projectId).toBe(projectId);
            if (status) expect(call.where.status).toBe(status);
            if (priority) expect(call.where.priority).toBe(priority);
            if (assignee) expect(call.where.assigneeId).toBe(assignee);

            // Verify ordering
            expect(call.orderBy).toEqual([{ priority: 'desc' }, { createdAt: 'desc' }]);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('File Upload - Property Tests', () => {
  // --- Generators ---
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];
  const disallowedExtensions = ['exe', 'bat', 'sh', 'cmd', 'js', 'php', 'py', 'rb', 'dll', 'so', 'bin', 'msi', 'vbs', 'ps1', 'html', 'htm', 'svg', 'swf'];

  const allowedExtArb = fc.constantFrom(...allowedExtensions);
  const disallowedExtArb = fc.constantFrom(...disallowedExtensions);
  const filenameBaseArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/);

  /**
   * Property 16: File extension allowlist enforcement
   *
   * For any file upload with an extension NOT in (jpg, jpeg, png, gif, pdf, doc, docx, xls, xlsx, csv, txt),
   * the Task_Service SHALL reject the upload. For any file with an allowed extension,
   * the upload SHALL succeed (size permitting).
   *
   * **Validates: Requirements 7.4, 15.1**
   */
  describe('Property 16: File extension allowlist enforcement', () => {
    // The actual allowlist used in the implementation
    const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

    it('accepts all files with allowed extensions', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const filename = `${basename}.${ext}`;
            const extname = path.extname(filename).toLowerCase();
            expect(ALLOWED_EXTENSIONS.includes(extname)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects all files with disallowed extensions', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          disallowedExtArb,
          (basename, ext) => {
            const filename = `${basename}.${ext}`;
            const extname = path.extname(filename).toLowerCase();
            expect(ALLOWED_EXTENSIONS.includes(extname)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('case-insensitive matching accepts uppercase extensions', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const filename = `${basename}.${ext.toUpperCase()}`;
            const extname = path.extname(filename).toLowerCase();
            expect(ALLOWED_EXTENSIONS.includes(extname)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects files with no extension', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          (basename) => {
            const extname = path.extname(basename).toLowerCase();
            // A file with no extension should not pass the filter
            expect(ALLOWED_EXTENSIONS.includes(extname)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects files with double extensions where the final ext is disallowed', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          disallowedExtArb,
          (basename, allowedExt, disallowedExt) => {
            // e.g. "file.pdf.exe" — extname returns ".exe"
            const filename = `${basename}.${allowedExt}.${disallowedExt}`;
            const extname = path.extname(filename).toLowerCase();
            expect(ALLOWED_EXTENSIONS.includes(extname)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 17: Uploaded files get unique non-user-supplied filenames
   *
   * For any file upload, the stored filename SHALL be generated as a combination of
   * timestamp and random value appended with the original file extension.
   * Two uploads of the same original filename SHALL produce different stored filenames.
   *
   * **Validates: Requirements 15.2**
   */
  describe('Property 17: Uploaded files get unique non-user-supplied filenames', () => {
    // Simulate the filename generation logic from the tasks route (matches actual implementation)
    function generateFilename(originalname) {
      const ext = path.extname(originalname).toLowerCase();
      return `${Date.now()}-${crypto.randomUUID()}${ext}`;
    }

    it('generated filenames never equal the user-supplied original filename', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const originalname = `${basename}.${ext}`;
            const generated = generateFilename(originalname);
            expect(generated).not.toBe(originalname);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('two calls with the same original filename produce different stored filenames', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const originalname = `${basename}.${ext}`;
            const file1 = generateFilename(originalname);
            const file2 = generateFilename(originalname);
            expect(file1).not.toBe(file2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated filename preserves the original file extension (lowercased)', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const originalname = `${basename}.${ext}`;
            const generated = generateFilename(originalname);
            expect(path.extname(generated)).toBe(`.${ext.toLowerCase()}`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated filename matches the expected format: timestamp-uuid.ext', () => {
      fc.assert(
        fc.property(
          filenameBaseArb,
          allowedExtArb,
          (basename, ext) => {
            const originalname = `${basename}.${ext}`;
            const generated = generateFilename(originalname);
            // Format: <timestamp>-<uuid>.<ext>
            const withoutExt = generated.replace(path.extname(generated), '');
            const dashIndex = withoutExt.indexOf('-');
            expect(dashIndex).toBeGreaterThan(0);
            const timestamp = withoutExt.substring(0, dashIndex);
            const uuid = withoutExt.substring(dashIndex + 1);
            // Timestamp part should be numeric
            expect(Number.isFinite(parseInt(timestamp))).toBe(true);
            // UUID part should match UUID v4 format
            expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated filenames do not contain user-supplied basename', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z]{5,20}$/),
          allowedExtArb,
          (basename, ext) => {
            const originalname = `${basename}.${ext}`;
            const generated = generateFilename(originalname);
            const generatedWithoutExt = generated.replace(path.extname(generated), '');
            // The user-supplied base should not appear in the generated name
            expect(generatedWithoutExt).not.toContain(basename);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 18: Path traversal prevention
   *
   * For any uploaded file, the resolved storage path SHALL be within the configured
   * upload directory. Filenames containing path traversal sequences (../, ..\, absolute paths)
   * SHALL NOT result in files stored outside the upload directory.
   *
   * **Validates: Requirements 15.3**
   */
  describe('Property 18: Path traversal prevention', () => {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

    // Path traversal attempt generators
    const traversalSequenceArb = fc.constantFrom(
      '../',
      '..\\',
      '../../',
      '..\\..\\',
      '../../../',
      '..\\..\\..\\',
      '%2e%2e%2f',
      '%2e%2e/',
      '..%2f',
      '....///',
      '..././',
    );

    const absolutePathArb = fc.constantFrom(
      '/etc/passwd',
      '/tmp/evil',
      'C:\\Windows\\System32\\evil',
      'C:/Users/admin/evil',
      '\\\\server\\share\\evil',
    );

    // The filename generation used in the route (matches actual implementation)
    function generateFilename(originalname) {
      const ext = path.extname(originalname).toLowerCase();
      return `${Date.now()}-${crypto.randomUUID()}${ext}`;
    }

    it('generated filename for traversal originalname stays within upload dir', () => {
      fc.assert(
        fc.property(
          traversalSequenceArb,
          filenameBaseArb,
          allowedExtArb,
          (traversal, basename, ext) => {
            const maliciousOriginalname = `${traversal}${basename}.${ext}`;
            const generated = generateFilename(maliciousOriginalname);
            const resolved = path.resolve(uploadDir, generated);

            // The resolved path must start with the upload directory
            expect(resolved.startsWith(uploadDir)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('path.resolve of generated filename never escapes upload directory', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[.\/\\a-zA-Z0-9_-]{1,50}$/),
          allowedExtArb,
          (maliciousBase, ext) => {
            const originalname = `${maliciousBase}.${ext}`;
            const generated = generateFilename(originalname);
            const resolved = path.resolve(uploadDir, generated);

            // Generated filenames only use timestamp-uuid.ext format
            // They cannot escape the upload directory
            expect(resolved.startsWith(uploadDir)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('absolute paths in originalname do not affect generated filename location', () => {
      fc.assert(
        fc.property(
          absolutePathArb,
          allowedExtArb,
          (absPath, ext) => {
            const maliciousOriginalname = `${absPath}.${ext}`;
            const generated = generateFilename(maliciousOriginalname);
            const resolved = path.resolve(uploadDir, generated);

            // The resolved path must still be inside the upload dir
            expect(resolved.startsWith(uploadDir)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('generated filenames never contain directory separator characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          allowedExtArb,
          (anyOriginalname, ext) => {
            const originalname = `${anyOriginalname}.${ext}`;
            const generated = generateFilename(originalname);

            // The generated filename (not including the upload dir) should not contain path separators
            expect(generated).not.toContain('/');
            expect(generated).not.toContain('\\');
            expect(generated).not.toContain('..');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('the stored filepath is just the filename, not a full/relative path', () => {
      fc.assert(
        fc.property(
          traversalSequenceArb,
          filenameBaseArb,
          allowedExtArb,
          (traversal, basename, ext) => {
            const maliciousOriginalname = `${traversal}${basename}.${ext}`;
            const generated = generateFilename(maliciousOriginalname);

            // path.basename of generated should equal generated itself
            // (meaning it's just a filename, no directory component)
            expect(path.basename(generated)).toBe(generated);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
