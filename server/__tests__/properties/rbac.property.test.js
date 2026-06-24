const fc = require('fast-check');
const express = require('express');
const request = require('supertest');
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
  project: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  projectMember: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  task: {
    updateMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
}));

// Mock audit logger
jest.mock('../../src/services/auditLogger', () => ({
  logAudit: jest.fn(),
}));

// Mock notification service
jest.mock('../../src/services/notificationService', () => ({
  notifyMemberAdded: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require('../../src/config/database');
const { notifyMemberAdded } = require('../../src/services/notificationService');
const { errorHandler } = require('../../src/middleware/errorHandler');

// Create a test app with project routes
function createApp() {
  const app = express();
  app.use(express.json());
  const projectRoutes = require('../../src/routes/projects');
  app.use('/projects', projectRoutes);
  app.use(errorHandler);
  return app;
}

describe('RBAC - Property Tests', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---
  // UUID v4 generator that passes the /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i regex
  const hexChar = fc.constantFrom(...'0123456789abcdef'.split(''));
  const hexStr = (len) => fc.array(hexChar, { minLength: len, maxLength: len }).map(a => a.join(''));
  const uuidV4Arb = fc.tuple(
    hexStr(8), hexStr(4), hexStr(3), fc.constantFrom('8', '9', 'a', 'b'), hexStr(3), hexStr(12)
  ).map(([a, b, c, d, e, f]) => `${a}-${b}-4${c}-${d}${e}-${f}`);

  const userIdArb = uuidV4Arb;
  const projectIdArb = uuidV4Arb;
  const projectNameArb = fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/).filter(s => s.trim().length > 0);
  const projectDescArb = fc.string({ minLength: 0, maxLength: 500 });
  const roleArb = fc.constantFrom('admin', 'member');

  /**
   * Property 8: Role-Based Access Control enforcement
   *
   * For any project operation, the system SHALL enforce: members can view all and create/update
   * only their own tasks; admins can manage members (add/remove "member" role) and all tasks;
   * owners have full control including archiving and role changes. A user with insufficient role
   * SHALL receive 403.
   *
   * **Validates: Requirements 4.9, 4.10, 4.11, 3.6, 3.8, 5.7**
   */
  describe('Property 8: Role-Based Access Control enforcement', () => {
    it('members cannot update project settings (receives 403)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          projectNameArb,
          async (projectId, userId, newName) => {
            jest.clearAllMocks();

            // User is a member (not admin/owner)
            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'member',
            });

            const res = await request(app)
              .put(`/projects/${projectId}`)
              .set('x-test-user-id', userId)
              .send({ name: newName });

            // Member should get 403 for project update
            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('admins and owners can update project settings (receives 200)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          projectNameArb,
          fc.constantFrom('admin', 'owner'),
          async (projectId, userId, newName, role) => {
            jest.clearAllMocks();

            // User is admin or owner
            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role,
            });

            prisma.project.update.mockResolvedValue({
              id: projectId,
              name: newName,
              members: [],
            });

            const res = await request(app)
              .put(`/projects/${projectId}`)
              .set('x-test-user-id', userId)
              .send({ name: newName });

            expect(res.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('only owners can archive a project (non-owners receive 403)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          fc.constantFrom('admin', 'member'),
          async (projectId, userId, role) => {
            jest.clearAllMocks();

            // User is admin or member (NOT owner)
            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role,
            });

            const res = await request(app)
              .delete(`/projects/${projectId}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('owners can archive a project (receives 200)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          async (projectId, userId) => {
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockResolvedValue({
              userId,
              projectId,
              role: 'owner',
            });

            prisma.project.update.mockResolvedValue({
              id: projectId,
              status: 'archived',
            });

            const res = await request(app)
              .delete(`/projects/${projectId}`)
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('non-members cannot access project (receives 403)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          async (projectId, userId) => {
            jest.clearAllMocks();

            // User is NOT a member
            prisma.projectMember.findUnique.mockResolvedValue(null);

            const res = await request(app)
              .put(`/projects/${projectId}`)
              .set('x-test-user-id', userId)
              .send({ name: 'Updated' });

            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('admins can add members but members cannot', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, newUserId) => {
            fc.pre(actorId !== newUserId);
            jest.clearAllMocks();

            // Actor is a regular member (not admin/owner)
            prisma.projectMember.findUnique.mockResolvedValue({
              userId: actorId,
              projectId,
              role: 'member',
            });

            const res = await request(app)
              .post(`/projects/${projectId}/members`)
              .set('x-test-user-id', actorId)
              .send({ userId: newUserId, role: 'member' });

            // Members cannot add other members
            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('admins cannot remove other admins (only owners can)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, adminActorId, targetAdminId) => {
            fc.pre(adminActorId !== targetAdminId);
            jest.clearAllMocks();

            // Actor is an admin
            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === adminActorId) {
                  return Promise.resolve({ userId: adminActorId, projectId, role: 'admin' });
                }
                if (where.projectId_userId.userId === targetAdminId) {
                  return Promise.resolve({ id: 'member-id', userId: targetAdminId, projectId, role: 'admin' });
                }
              }
              return Promise.resolve(null);
            });

            const res = await request(app)
              .delete(`/projects/${projectId}/members/${targetAdminId}`)
              .set('x-test-user-id', adminActorId);

            // Admins cannot remove other admins
            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('owner cannot be removed from the project', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, ownerId) => {
            fc.pre(actorId !== ownerId);
            jest.clearAllMocks();

            // Actor is owner (trying to remove themselves or another owner scenario)
            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                if (where.projectId_userId.userId === ownerId) {
                  return Promise.resolve({ id: 'member-id', userId: ownerId, projectId, role: 'owner' });
                }
              }
              return Promise.resolve(null);
            });

            const res = await request(app)
              .delete(`/projects/${projectId}/members/${ownerId}`)
              .set('x-test-user-id', actorId);

            // Owner cannot be removed
            expect(res.status).toBe(403);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 9: Member addition creates notification
   *
   * For any user added to a project, the Notification_Service SHALL create a
   * "project_member_added" notification for that user containing the project name
   * and assigned role.
   *
   * **Validates: Requirements 4.1, 8.6**
   */
  describe('Property 9: Member addition creates notification', () => {
    it('adding a member calls notifyMemberAdded with correct project name, userId, and role', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          projectNameArb,
          roleArb,
          async (projectId, actorId, newUserId, projectName, role) => {
            fc.pre(actorId !== newUserId);
            jest.clearAllMocks();

            // Actor is admin/owner
            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                // New user is not yet a member
                if (where.projectId_userId.userId === newUserId) {
                  return Promise.resolve(null);
                }
              }
              return Promise.resolve(null);
            });

            // User exists
            prisma.user.findUnique.mockResolvedValue({ id: newUserId, email: 'new@test.com' });

            // Under 50 members
            prisma.projectMember.count.mockResolvedValue(5);

            // Create membership
            prisma.projectMember.create.mockResolvedValue({
              userId: newUserId,
              projectId,
              role,
              user: { id: newUserId, displayName: 'New User', email: 'new@test.com', avatarUrl: null },
            });

            // Project exists with a name
            prisma.project.findUnique.mockResolvedValue({ id: projectId, name: projectName });

            const res = await request(app)
              .post(`/projects/${projectId}/members`)
              .set('x-test-user-id', actorId)
              .send({ userId: newUserId, role });

            expect(res.status).toBe(201);
            // notifyMemberAdded should have been called with the project name, user id, and role
            expect(notifyMemberAdded).toHaveBeenCalledTimes(1);
            expect(notifyMemberAdded).toHaveBeenCalledWith(projectName, newUserId, role);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('notification is always created for the added user (not the actor)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          projectNameArb,
          async (projectId, actorId, newUserId, projectName) => {
            fc.pre(actorId !== newUserId);
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'admin' });
                }
                if (where.projectId_userId.userId === newUserId) {
                  return Promise.resolve(null);
                }
              }
              return Promise.resolve(null);
            });

            prisma.user.findUnique.mockResolvedValue({ id: newUserId, email: 'new@test.com' });
            prisma.projectMember.count.mockResolvedValue(3);
            prisma.projectMember.create.mockResolvedValue({
              userId: newUserId,
              projectId,
              role: 'member',
              user: { id: newUserId, displayName: 'New User', email: 'new@test.com', avatarUrl: null },
            });
            prisma.project.findUnique.mockResolvedValue({ id: projectId, name: projectName });

            await request(app)
              .post(`/projects/${projectId}/members`)
              .set('x-test-user-id', actorId)
              .send({ userId: newUserId, role: 'member' });

            // The notification is for the new user, not the actor
            expect(notifyMemberAdded).toHaveBeenCalledWith(
              projectName,
              newUserId,
              'member'
            );
            // First argument of the call is the project name
            const callArgs = notifyMemberAdded.mock.calls[0];
            expect(callArgs[1]).toBe(newUserId);
            expect(callArgs[1]).not.toBe(actorId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('no notification is created if member addition fails (user already a member)', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, existingUserId) => {
            fc.pre(actorId !== existingUserId);
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                // User is already a member
                if (where.projectId_userId.userId === existingUserId) {
                  return Promise.resolve({ userId: existingUserId, projectId, role: 'member' });
                }
              }
              return Promise.resolve(null);
            });

            prisma.user.findUnique.mockResolvedValue({ id: existingUserId, email: 'existing@test.com' });

            const res = await request(app)
              .post(`/projects/${projectId}/members`)
              .set('x-test-user-id', actorId)
              .send({ userId: existingUserId, role: 'member' });

            expect(res.status).toBe(409);
            // No notification should be sent on failure
            expect(notifyMemberAdded).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 10: Member removal unassigns tasks
   *
   * For any member removed from a project who has tasks assigned to them in that project,
   * the Project_Service SHALL delete the membership record AND set assigneeId to null on all
   * tasks previously assigned to that member within the project.
   *
   * **Validates: Requirements 4.6**
   */
  describe('Property 10: Member removal unassigns tasks', () => {
    it('removing a member unassigns all their tasks in the project', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          fc.integer({ min: 0, max: 20 }),
          async (projectId, actorId, removedUserId, taskCount) => {
            fc.pre(actorId !== removedUserId);
            jest.clearAllMocks();

            // Actor is owner
            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                if (where.projectId_userId.userId === removedUserId) {
                  return Promise.resolve({ id: 'target-member-id', userId: removedUserId, projectId, role: 'member' });
                }
              }
              return Promise.resolve(null);
            });

            prisma.projectMember.delete.mockResolvedValue({});
            prisma.task.updateMany.mockResolvedValue({ count: taskCount });

            const res = await request(app)
              .delete(`/projects/${projectId}/members/${removedUserId}`)
              .set('x-test-user-id', actorId);

            expect(res.status).toBe(200);

            // Membership should be deleted
            expect(prisma.projectMember.delete).toHaveBeenCalledTimes(1);
            expect(prisma.projectMember.delete).toHaveBeenCalledWith({
              where: { id: 'target-member-id' },
            });

            // Tasks should be unassigned
            expect(prisma.task.updateMany).toHaveBeenCalledTimes(1);
            expect(prisma.task.updateMany).toHaveBeenCalledWith({
              where: { projectId, assigneeId: removedUserId },
              data: { assigneeId: null },
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('task unassignment targets only the removed user in the specific project', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, removedUserId) => {
            fc.pre(actorId !== removedUserId);
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                if (where.projectId_userId.userId === removedUserId) {
                  return Promise.resolve({ id: 'member-id-123', userId: removedUserId, projectId, role: 'member' });
                }
              }
              return Promise.resolve(null);
            });

            prisma.projectMember.delete.mockResolvedValue({});
            prisma.task.updateMany.mockResolvedValue({ count: 3 });

            await request(app)
              .delete(`/projects/${projectId}/members/${removedUserId}`)
              .set('x-test-user-id', actorId);

            // updateMany should use the exact projectId and removedUserId
            const updateCall = prisma.task.updateMany.mock.calls[0][0];
            expect(updateCall.where.projectId).toBe(projectId);
            expect(updateCall.where.assigneeId).toBe(removedUserId);
            // The data sets assigneeId to null
            expect(updateCall.data.assigneeId).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('membership deletion and task unassignment both happen on removal', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, removedUserId) => {
            fc.pre(actorId !== removedUserId);
            jest.clearAllMocks();

            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'admin' });
                }
                if (where.projectId_userId.userId === removedUserId) {
                  return Promise.resolve({ id: 'del-id', userId: removedUserId, projectId, role: 'member' });
                }
              }
              return Promise.resolve(null);
            });

            prisma.projectMember.delete.mockResolvedValue({});
            prisma.task.updateMany.mockResolvedValue({ count: 0 });

            const res = await request(app)
              .delete(`/projects/${projectId}/members/${removedUserId}`)
              .set('x-test-user-id', actorId);

            expect(res.status).toBe(200);
            // Both operations must have been called
            expect(prisma.projectMember.delete).toHaveBeenCalledTimes(1);
            expect(prisma.task.updateMany).toHaveBeenCalledTimes(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('removal of owner is rejected — tasks are NOT unassigned', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectIdArb,
          userIdArb,
          userIdArb,
          async (projectId, actorId, ownerId) => {
            fc.pre(actorId !== ownerId);
            jest.clearAllMocks();

            // Actor is an owner, target is also an owner (simulating the protection)
            prisma.projectMember.findUnique.mockImplementation(({ where }) => {
              if (where.projectId_userId) {
                if (where.projectId_userId.userId === actorId) {
                  return Promise.resolve({ userId: actorId, projectId, role: 'owner' });
                }
                if (where.projectId_userId.userId === ownerId) {
                  return Promise.resolve({ id: 'owner-member-id', userId: ownerId, projectId, role: 'owner' });
                }
              }
              return Promise.resolve(null);
            });

            const res = await request(app)
              .delete(`/projects/${projectId}/members/${ownerId}`)
              .set('x-test-user-id', actorId);

            expect(res.status).toBe(403);
            // Neither delete nor updateMany should have been called
            expect(prisma.projectMember.delete).not.toHaveBeenCalled();
            expect(prisma.task.updateMany).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
