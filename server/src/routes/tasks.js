const { Router } = require('express');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../config/database');
const auth = require('../middleware/auth');
const projectAccess = require('../middleware/projectAccess');
const { validate, validateUuidParam, sanitizeHtml } = require('../middleware/inputValidator');
const { notifyTaskAssigned, notifyTaskComment } = require('../services/notificationService');

const router = Router();

// Priority ranking for custom ordering (higher = more urgent)
const PRIORITY_RANK = { low: 0, medium: 1, high: 2, urgent: 3 };

// Zod schemas for task creation and update
const taskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'in_review', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
});

const taskUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'in_review', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(2000),
});

// Allowed file extensions for upload
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'];

// Multer storage configuration for file attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    // Verify the generated path stays within the upload directory (path traversal prevention)
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const fullPath = path.resolve(uploadDir, uniqueName);
    if (!fullPath.startsWith(uploadDir)) {
      return cb(new Error('Invalid file path'), null);
    }
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  },
});

/**
 * Sort tasks by priority descending (urgent > high > medium > low) then createdAt descending.
 */
function sortTasksByPriority(tasks) {
  return tasks.sort((a, b) => {
    const priorityDiff = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

// GET /api/tasks/project/:projectId - List project tasks with filtering
router.get('/project/:projectId', auth, validateUuidParam('projectId'), projectAccess('member'), async (req, res, next) => {
  try {
    const { status, assignee, priority } = req.query;
    const where = { projectId: req.params.projectId };
    if (status) where.status = status;
    if (assignee) where.assigneeId = assignee;
    if (priority) where.priority = priority;

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        creator: { select: { id: true, displayName: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    // Apply correct priority ordering (urgent > high > medium > low)
    // Prisma sorts alphabetically so we re-sort in memory for semantic correctness
    const sorted = sortTasksByPriority(tasks);
    res.json(sorted);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/project/:projectId - Create a task
router.post('/project/:projectId', auth, validateUuidParam('projectId'), projectAccess('member'), validate(taskCreateSchema), async (req, res, next) => {
  try {
    const data = req.body;

    // Sanitize title and description
    const sanitizedTitle = sanitizeHtml(data.title);
    const sanitizedDescription = data.description ? sanitizeHtml(data.description) : undefined;

    const task = await prisma.task.create({
      data: {
        projectId: req.params.projectId,
        title: sanitizedTitle,
        description: sanitizedDescription,
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        assigneeId: data.assigneeId || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        createdBy: req.user.id,
      },
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        creator: { select: { id: true, displayName: true } },
      },
    });

    // Notify assignee if assigned to another user
    if (task.assigneeId && task.assigneeId !== req.user.id) {
      await notifyTaskAssigned(task, req.user.id);
    }

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/attachments/:id/download - Download attachment
router.get('/attachments/:id/download', auth, validateUuidParam('id'), async (req, res, next) => {
  try {
    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: req.params.id },
      include: { task: true },
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Not Found', message: 'Attachment not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: attachment.task.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const filepath = path.resolve(uploadDir, attachment.filepath);

    // Path traversal prevention
    if (!filepath.startsWith(uploadDir)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Invalid file path', statusCode: 403 });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Not Found', message: 'File not found on disk', statusCode: 404 });
    }

    // Serve with Content-Type from stored mimeType and Content-Disposition for download
    const contentType = attachment.mimeType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
    fs.createReadStream(filepath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/attachments/:id - Delete attachment
router.delete('/attachments/:id', auth, validateUuidParam('id'), async (req, res, next) => {
  try {
    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: req.params.id },
      include: { task: true },
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Not Found', message: 'Attachment not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: attachment.task.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }
    const isAdmin = member.role === 'admin' || member.role === 'owner';
    if (attachment.uploadedBy !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the uploader or admin can delete', statusCode: 403 });
    }
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const filepath = path.resolve(uploadDir, attachment.filepath);

    // Path traversal prevention
    if (filepath.startsWith(uploadDir) && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    await prisma.taskAttachment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id - Get a single task
router.get('/:id', auth, validateUuidParam('id'), async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        creator: { select: { id: true, displayName: true } },
        comments: {
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: { uploader: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!task) {
      return res.status(404).json({ error: 'Not Found', message: 'Task not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// PUT /api/tasks/:id - Update a task
router.put('/:id', auth, validateUuidParam('id'), validate(taskUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'Task not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: existing.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }

    // Permission check: only assignee or admin/owner can update
    const isAssignee = existing.assigneeId === req.user.id;
    const isAdmin = member.role === 'admin' || member.role === 'owner';
    if (!isAssignee && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the assignee or admin can edit this task', statusCode: 403 });
    }

    const data = req.body;

    // Sanitize title and description if provided
    const updateData = {};
    if (data.title !== undefined) updateData.title = sanitizeHtml(data.title);
    if (data.description !== undefined) updateData.description = sanitizeHtml(data.description);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        creator: { select: { id: true, displayName: true } },
      },
    });

    // Notify on task assignment to another user
    if (data.assigneeId && data.assigneeId !== req.user.id && data.assigneeId !== existing.assigneeId) {
      await notifyTaskAssigned(task, req.user.id);
    }

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id - Delete a task
router.delete('/:id', auth, validateUuidParam('id'), async (req, res, next) => {
  try {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Not Found', message: 'Task not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: existing.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }

    // Permission check: only creator or admin/owner can delete
    const isCreator = existing.createdBy === req.user.id;
    const isAdmin = member.role === 'admin' || member.role === 'owner';
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the creator or admin can delete this task', statusCode: 403 });
    }

    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/comments - Add a comment to a task
router.post('/:id/comments', auth, validateUuidParam('id'), validate(commentSchema), async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) {
      return res.status(404).json({ error: 'Not Found', message: 'Task not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } },
    });
    if (!member) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }

    // Sanitize comment content
    const sanitizedContent = sanitizeHtml(req.body.content);

    const comment = await prisma.taskComment.create({
      data: { taskId: req.params.id, userId: req.user.id, content: sanitizedContent },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    await notifyTaskComment(task, req.user.id);

    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/attachments - Upload a file attachment
router.post('/:id/attachments', auth, validateUuidParam('id'), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Payload Too Large', message: 'File exceeds maximum size of 10MB', statusCode: 413 });
      }
      if (err.message === 'File type not allowed') {
        return res.status(400).json({ error: 'Bad Request', message: 'File type not allowed', statusCode: 400 });
      }
      return next(err);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Bad Request', message: 'No file uploaded', statusCode: 400 });
    }
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Not Found', message: 'Task not found', statusCode: 404 });
    }
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } },
    });
    if (!member) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Forbidden', message: 'Not a project member', statusCode: 403 });
    }

    // Path traversal prevention - verify stored file is within upload directory
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const resolvedPath = path.resolve(req.file.path);
    if (!resolvedPath.startsWith(uploadDir)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Forbidden', message: 'Invalid file path', statusCode: 403 });
    }

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: req.params.id,
        filename: req.file.originalname,
        filepath: req.file.filename,
        filesize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user.id,
      },
      include: { uploader: { select: { id: true, displayName: true } } },
    });
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
