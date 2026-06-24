const fc = require('fast-check');
const { notifyTaskAssigned, notifyTaskComment } = require('../../src/services/notificationService');

// Mock the prisma client
jest.mock('../../src/config/database', () => ({
  notification: {
    create: jest.fn(),
  },
}));

const prisma = require('../../src/config/database');

describe('Notification Service - Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });
  });

  /**
   * Property 12: Task assignment notification (excluding self-assign)
   *
   * For any task assignment where the new assignee differs from the acting user,
   * the Notification_Service SHALL create a "task_assigned" notification for the assignee.
   * When the actor assigns to themselves, no notification SHALL be created.
   *
   * **Validates: Requirements 5.9, 8.5**
   */
  describe('Property 12: Task assignment notification (excluding self-assign)', () => {
    // Generator for user IDs (non-empty strings simulating UUIDs)
    const userIdArb = fc.uuid();
    const taskIdArb = fc.uuid();
    const taskTitleArb = fc.string({ minLength: 1, maxLength: 200 });

    it('creates exactly one notification for the assignee when assigneeId !== actorId', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,
          userIdArb,
          async (taskId, taskTitle, assigneeId, actorId) => {
            // Ensure assignee and actor are different
            fc.pre(assigneeId !== actorId);

            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId };
            await notifyTaskAssigned(task, actorId);

            // Exactly one notification created
            expect(prisma.notification.create).toHaveBeenCalledTimes(1);
            // Notification is for the assignee
            expect(prisma.notification.create).toHaveBeenCalledWith({
              data: expect.objectContaining({
                userId: assigneeId,
                type: 'task_assigned',
                relatedTaskId: taskId,
              }),
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('creates no notification when assigneeId === actorId (self-assign)', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,
          async (taskId, taskTitle, userId) => {
            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            // Self-assignment: assignee is the same as actor
            const task = { id: taskId, title: taskTitle, assigneeId: userId };
            await notifyTaskAssigned(task, userId);

            // No notification created
            expect(prisma.notification.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('creates no notification when task has no assignee', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,
          async (taskId, taskTitle, actorId) => {
            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId: null };
            await notifyTaskAssigned(task, actorId);

            expect(prisma.notification.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 13: Comment notification (excluding commenter)
   *
   * For any comment posted on a task, the Notification_Service SHALL create
   * "task_comment" notifications for the task assignee and task creator,
   * excluding the user who posted the comment, with no duplicate notifications
   * if assignee equals creator.
   *
   * **Validates: Requirements 7.1, 8.7**
   */
  describe('Property 13: Comment notification (excluding commenter)', () => {
    const userIdArb = fc.uuid();
    const taskIdArb = fc.uuid();
    const taskTitleArb = fc.string({ minLength: 1, maxLength: 200 });

    it('never sends a notification to the commenter', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          fc.option(userIdArb, { nil: null }),  // assigneeId (nullable)
          fc.option(userIdArb, { nil: null }),  // createdBy (nullable)
          userIdArb,                             // commenterId
          async (taskId, taskTitle, assigneeId, createdBy, commenterId) => {
            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId, createdBy };
            await notifyTaskComment(task, commenterId);

            // The commenter should never receive a notification
            const calls = prisma.notification.create.mock.calls;
            for (const call of calls) {
              expect(call[0].data.userId).not.toBe(commenterId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('deduplicates notifications when assignee === creator', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,  // same user is both assignee and creator
          userIdArb,  // commenterId
          async (taskId, taskTitle, assigneeCreator, commenterId) => {
            // Ensure commenter is different so notifications are created
            fc.pre(assigneeCreator !== commenterId);

            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId: assigneeCreator, createdBy: assigneeCreator };
            await notifyTaskComment(task, commenterId);

            // Should only create exactly 1 notification (deduplicated)
            expect(prisma.notification.create).toHaveBeenCalledTimes(1);
            expect(prisma.notification.create).toHaveBeenCalledWith({
              data: expect.objectContaining({
                userId: assigneeCreator,
                type: 'task_comment',
              }),
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('notifies both assignee and creator when they are different and neither is the commenter', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,  // assigneeId
          userIdArb,  // createdBy
          userIdArb,  // commenterId
          async (taskId, taskTitle, assigneeId, createdBy, commenterId) => {
            // Ensure all three are distinct
            fc.pre(assigneeId !== createdBy);
            fc.pre(assigneeId !== commenterId);
            fc.pre(createdBy !== commenterId);

            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId, createdBy };
            await notifyTaskComment(task, commenterId);

            // Should create exactly 2 notifications
            expect(prisma.notification.create).toHaveBeenCalledTimes(2);

            const notifiedUserIds = prisma.notification.create.mock.calls.map(
              (call) => call[0].data.userId
            );
            expect(notifiedUserIds).toContain(assigneeId);
            expect(notifiedUserIds).toContain(createdBy);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('creates no notifications when commenter is both assignee and creator', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          userIdArb,
          async (taskId, taskTitle, userId) => {
            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            // Commenter is both assignee and creator
            const task = { id: taskId, title: taskTitle, assigneeId: userId, createdBy: userId };
            await notifyTaskComment(task, userId);

            expect(prisma.notification.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all notifications have type "task_comment" and correct relatedTaskId', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskIdArb,
          taskTitleArb,
          fc.option(userIdArb, { nil: null }),
          fc.option(userIdArb, { nil: null }),
          userIdArb,
          async (taskId, taskTitle, assigneeId, createdBy, commenterId) => {
            jest.clearAllMocks();
            prisma.notification.create.mockResolvedValue({ id: 'notif-mock' });

            const task = { id: taskId, title: taskTitle, assigneeId, createdBy };
            await notifyTaskComment(task, commenterId);

            const calls = prisma.notification.create.mock.calls;
            for (const call of calls) {
              expect(call[0].data.type).toBe('task_comment');
              expect(call[0].data.relatedTaskId).toBe(taskId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
