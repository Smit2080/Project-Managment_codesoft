const express = require('express');
const request = require('supertest');

// Mock prisma before requiring the router
jest.mock('../../src/config/database', () => ({
  notification: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
}));

// Mock auth middleware to inject user
jest.mock('../../src/middleware/auth', () => {
  return (req, res, next) => {
    req.user = { id: 'user-1', email: 'test@test.com', displayName: 'Test User' };
    next();
  };
});

const prisma = require('../../src/config/database');
const notificationRoutes = require('../../src/routes/notifications');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  return app;
}

describe('Notification Routes', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/notifications', () => {
    it('should return up to 50 notifications ordered by createdAt desc with unread count', async () => {
      const mockNotifications = [
        { id: 'n1', type: 'task_assigned', message: 'You were assigned', read: false, relatedTaskId: 'task-1', createdAt: '2024-01-02T00:00:00Z' },
        { id: 'n2', type: 'project_member_added', message: 'Added to project', read: true, relatedTaskId: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.notification.count.mockResolvedValue(1);

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.unreadCount).toBe(1);
      expect(res.body.notifications[0]).toHaveProperty('id');
      expect(res.body.notifications[0]).toHaveProperty('type');
      expect(res.body.notifications[0]).toHaveProperty('message');
      expect(res.body.notifications[0]).toHaveProperty('read');
      expect(res.body.notifications[0]).toHaveProperty('relatedTaskId');
      expect(res.body.notifications[0]).toHaveProperty('createdAt');
    });

    it('should query with correct userId and order/limit params', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await request(app).get('/api/notifications');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          message: true,
          read: true,
          relatedTaskId: true,
          createdAt: true,
        },
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
      });
    });

    it('should return empty array and 0 unread when user has no notifications', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notifications).toEqual([]);
      expect(res.body.unreadCount).toBe(0);
    });
  });

  describe('PUT /api/notifications/:id/read', () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';

    it('should mark a notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: validUuid,
        userId: 'user-1',
        read: false,
      });
      prisma.notification.update.mockResolvedValue({ id: validUuid, read: true });

      const res = await request(app).put(`/api/notifications/${validUuid}/read`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Marked as read');
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: validUuid },
        data: { read: true },
      });
    });

    it('should return 404 if notification not found', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      const res = await request(app).put(`/api/notifications/${validUuid}/read`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
      expect(res.body.message).toBe('Notification not found');
    });

    it('should return 403 if notification belongs to another user', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: validUuid,
        userId: 'user-2', // different user
        read: false,
      });

      const res = await request(app).put(`/api/notifications/${validUuid}/read`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('should return 400 for invalid UUID format', async () => {
      const res = await request(app).put('/api/notifications/not-a-uuid/read');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toBe('Invalid parameter format');
      // Should not attempt any database query
      expect(prisma.notification.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/notifications/read-all', () => {
    it('should mark all unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const res = await request(app).put('/api/notifications/read-all');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('All notifications marked as read');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
        data: { read: true },
      });
    });

    it('should succeed even when no unread notifications exist', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app).put('/api/notifications/read-all');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('All notifications marked as read');
    });
  });
});
