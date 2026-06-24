const { createNotification, notifyTaskAssigned, notifyMemberAdded, notifyTaskComment } = require('../../src/services/notificationService');

// Mock the prisma client
jest.mock('../../src/config/database', () => ({
  notification: {
    create: jest.fn(),
  },
}));

const prisma = require('../../src/config/database');

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
  });

  describe('createNotification', () => {
    it('should create a notification with the given payload', async () => {
      const payload = {
        userId: 'user-1',
        type: 'task_assigned',
        message: 'You have been assigned a task',
        relatedTaskId: 'task-1',
      };

      await createNotification(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'task_assigned',
          message: 'You have been assigned a task',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should set relatedTaskId to null when not provided', async () => {
      const payload = {
        userId: 'user-1',
        type: 'project_member_added',
        message: 'You were added to a project',
      };

      await createNotification(payload);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'project_member_added',
          message: 'You were added to a project',
          relatedTaskId: null,
        },
      });
    });
  });

  describe('notifyTaskAssigned', () => {
    it('should create a task_assigned notification for the assignee', async () => {
      const task = { id: 'task-1', title: 'Fix bug', assigneeId: 'user-2' };
      const actorId = 'user-1';

      await notifyTaskAssigned(task, actorId);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-2',
          type: 'task_assigned',
          message: 'You have been assigned to task "Fix bug"',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should skip notification when actor is the assignee (self-assignment)', async () => {
      const task = { id: 'task-1', title: 'Fix bug', assigneeId: 'user-1' };
      const actorId = 'user-1';

      await notifyTaskAssigned(task, actorId);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should skip notification when task has no assignee', async () => {
      const task = { id: 'task-1', title: 'Fix bug', assigneeId: null };
      const actorId = 'user-1';

      await notifyTaskAssigned(task, actorId);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyMemberAdded', () => {
    it('should create a project_member_added notification for the added user', async () => {
      await notifyMemberAdded('My Project', 'user-3', 'member');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-3',
          type: 'project_member_added',
          message: 'You have been added to project "My Project" as member',
          relatedTaskId: null,
        },
      });
    });

    it('should include the role in the notification message', async () => {
      await notifyMemberAdded('Backend', 'user-4', 'admin');

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-4',
          type: 'project_member_added',
          message: 'You have been added to project "Backend" as admin',
          relatedTaskId: null,
        },
      });
    });
  });

  describe('notifyTaskComment', () => {
    it('should notify assignee and creator, excluding the commenter', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: 'user-2', createdBy: 'user-3' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-2',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-3',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should deduplicate when assignee is also the creator', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: 'user-2', createdBy: 'user-2' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-2',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should not notify the commenter even if they are the assignee', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: 'user-1', createdBy: 'user-3' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-3',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should not notify the commenter even if they are the creator', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: 'user-2', createdBy: 'user-1' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-2',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
    });

    it('should not create any notifications when commenter is both assignee and creator', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: 'user-1', createdBy: 'user-1' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should handle task with no assignee', async () => {
      const task = { id: 'task-1', title: 'Design page', assigneeId: null, createdBy: 'user-3' };
      const commenterId = 'user-1';

      await notifyTaskComment(task, commenterId);

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-3',
          type: 'task_comment',
          message: 'New comment on task "Design page"',
          relatedTaskId: 'task-1',
        },
      });
    });
  });
});
