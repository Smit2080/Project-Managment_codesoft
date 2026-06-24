const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../config/database');
const auth = require('../middleware/auth');
const projectAccess = require('../middleware/projectAccess');
const { validate, validateUuidParam, sanitizeHtml } = require('../middleware/inputValidator');
const { logAudit } = require('../services/auditLogger');
const { notifyMemberAdded } = require('../services/notificationService');

const router = Router();

// Zod schemas for project creation and update
const projectCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const projectUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'member']).optional().default('member'),
});

const roleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

// GET /api/projects - List user's projects
router.get('/', auth, async (req, res, next) => {
  try {
    const memberships = await prisma.projectMember.findMany({
      where: { userId: req.user.id },
      include: {
        project: {
          include: {
            owner: { select: { id: true, displayName: true, email: true } },
            members: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
            _count: { select: { tasks: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    const projects = memberships.map(m => ({
      ...m.project,
      userRole: m.role,
    }));
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// POST /api/projects - Create a new project
router.post('/', auth, validate(projectCreateSchema), async (req, res, next) => {
  try {
    // req.body is already validated and sanitized by validate() middleware
    const data = req.body;
    const project = await prisma.project.create({
      data: {
        name: data.name,
        description: data.description,
        ownerId: req.user.id,
        members: {
          create: { userId: req.user.id, role: 'owner' },
        },
      },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        members: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
      },
    });

    // Audit log for project creation
    logAudit({
      userId: req.user.id,
      ip: req.ip,
      action: 'project_create',
      resourceType: 'project',
      resourceId: project.id,
      outcome: 'success',
    });

    res.status(201).json({ ...project, userRole: 'owner' });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id - Get a specific project
router.get('/:id', auth, validateUuidParam('id'), projectAccess('member'), async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        members: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } }, orderBy: { joinedAt: 'asc' } },
        _count: { select: { tasks: true } },
      },
    });
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: req.params.id, userId: req.user.id } },
    });
    res.json({ ...project, userRole: member?.role });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id - Update project settings (admin or owner only)
router.put('/:id', auth, validateUuidParam('id'), projectAccess('admin'), validate(projectUpdateSchema), async (req, res, next) => {
  try {
    // req.body is already validated and sanitized by validate() middleware
    const data = req.body;
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data,
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        members: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
      },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id - Archive project (owner only)
router.delete('/:id', auth, validateUuidParam('id'), projectAccess('owner'), async (req, res, next) => {
  try {
    await prisma.project.update({
      where: { id: req.params.id },
      data: { status: 'archived' },
    });

    // Audit log for project archival
    logAudit({
      userId: req.user.id,
      ip: req.ip,
      action: 'project_archive',
      resourceType: 'project',
      resourceId: req.params.id,
      outcome: 'success',
    });

    res.json({ message: 'Project archived' });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/members - Add a member (admin or owner only)
router.post('/:id/members', auth, validateUuidParam('id'), projectAccess('admin'), validate(memberSchema), async (req, res, next) => {
  try {
    const data = req.body;
    const projectId = req.params.id;

    // Check if user exists before adding
    const userExists = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!userExists) {
      return res.status(404).json({ error: 'Not Found', message: 'User not found', statusCode: 404 });
    }

    // Check if already a member
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: data.userId } },
    });
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'User is already a member', statusCode: 409 });
    }

    // Enforce 50-member limit
    const memberCount = await prisma.projectMember.count({ where: { projectId } });
    if (memberCount >= 50) {
      return res.status(400).json({ error: 'Bad Request', message: 'Project member limit of 50 has been reached', statusCode: 400 });
    }

    const membership = await prisma.projectMember.create({
      data: { projectId, userId: data.userId, role: data.role },
      include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
    });

    // Send notification via centralized notificationService (correct type: project_member_added)
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    await notifyMemberAdded(project.name, data.userId, data.role);

    res.status(201).json(membership);
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id/members/:userId - Update member role (owner only)
router.put('/:id/members/:userId', auth, validateUuidParam('id', 'userId'), projectAccess('owner'), validate(roleSchema), async (req, res, next) => {
  try {
    const data = req.body;
    const projectId = req.params.id;
    const userId = req.params.userId;

    // Check that the target member exists and is not the owner
    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'Member not found', statusCode: 404 });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Forbidden', message: 'Cannot change the owner role', statusCode: 403 });
    }

    const membership = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { role: data.role },
      include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
    });

    // Audit log for role change
    logAudit({
      userId: req.user.id,
      ip: req.ip,
      action: 'member_role_change',
      resourceType: 'member',
      resourceId: userId,
      outcome: 'success',
    });

    res.json(membership);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id/members/:userId - Remove a member (admin or owner)
router.delete('/:id/members/:userId', auth, validateUuidParam('id', 'userId'), projectAccess('admin'), async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const userId = req.params.userId;

    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'Member not found', statusCode: 404 });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Forbidden', message: 'Cannot remove the project owner', statusCode: 403 });
    }
    if (target.role === 'admin' && req.projectMember.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden', message: 'Only owners can remove admins', statusCode: 403 });
    }

    // Delete membership
    await prisma.projectMember.delete({
      where: { id: target.id },
    });

    // Unassign removed user from all tasks in this project
    await prisma.task.updateMany({
      where: { projectId, assigneeId: userId },
      data: { assigneeId: null },
    });

    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
