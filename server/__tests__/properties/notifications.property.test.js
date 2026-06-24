const fc = require('fast-check');
const express = require('express');
const request = require('supertest');

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
  notification: {
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../../src/config/database');
const { errorHandler } = require('../../src/middleware/errorHandler');

// Create a test app with notification routes
function createApp() {
  const app = express();
  app.use(express.json());
  const notificationRoutes = require('../../src/routes/notifications');
  app.use('/notifications', notificationRoutes);
  app.use(errorHandler);
  return app;
}

describe('Notifications - Property Tests', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---
  const uuidV4Arb = fc.uuid().filter(u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u));
  const userIdArb = uuidV4Arb;
  const notificationTypeArb = fc.constantFrom('task_assigned', 'project_member_added', 'task_comment');
  const messageArb = fc.string({ minLength: 1, maxLength: 200 });

  // Generator for a single notification record
  const notificationArb = fc.record({
    id: uuidV4Arb,
    type: notificationTypeArb,
    message: messageArb,
    read: fc.boolean(),
    relatedTaskId: fc.option(uuidV4Arb, { nil: null }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2026-12-31') }),
  });

  // Generator for a list of notifications (varying length)
  const notificationListArb = fc.array(notificationArb, { minLength: 0, maxLength: 80 });

  /**
   * Property 14: Notification retrieval returns at most 50 ordered by date with unread count
   *
   * For any user with N notifications, the notification endpoint SHALL return min(N, 50)
   * notifications ordered by creation date descending, plus the total unread count
   * across all notifications for that user.
   *
   * **Validates: Requirements 8.1**
   */
  describe('Property 14: Notification retrieval returns at most 50 ordered by date with unread count', () => {
    it('returns at most 50 notifications regardless of total count', async () => {
      await fc.assert(
        fc.asyncProperty(
          notificationListArb,
          userIdArb,
          async (notifications, userId) => {
            jest.clearAllMocks();

            // Sort by createdAt desc and take at most 50 (simulating DB behavior)
            const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt);
            const returned = sorted.slice(0, 50);
            const unreadCount = notifications.filter(n => !n.read).length;

            prisma.notification.findMany.mockResolvedValue(returned);
            prisma.notification.count.mockResolvedValue(unreadCount);

            const res = await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            // Must not exceed 50
            expect(res.body.notifications.length).toBeLessThanOrEqual(50);
            // Should return min(N, 50)
            expect(res.body.notifications.length).toBe(Math.min(notifications.length, 50));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('notifications are ordered by createdAt descending', async () => {
      await fc.assert(
        fc.asyncProperty(
          notificationListArb,
          userIdArb,
          async (notifications, userId) => {
            fc.pre(notifications.length >= 2);
            jest.clearAllMocks();

            // Sort by createdAt desc and take at most 50
            const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt);
            const returned = sorted.slice(0, 50);
            const unreadCount = notifications.filter(n => !n.read).length;

            prisma.notification.findMany.mockResolvedValue(returned);
            prisma.notification.count.mockResolvedValue(unreadCount);

            const res = await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            const items = res.body.notifications;
            // Check ordering: each item's createdAt >= next item's createdAt
            for (let i = 0; i < items.length - 1; i++) {
              const current = new Date(items[i].createdAt).getTime();
              const next = new Date(items[i + 1].createdAt).getTime();
              expect(current).toBeGreaterThanOrEqual(next);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('includes the total unread count across all user notifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          notificationListArb,
          userIdArb,
          async (notifications, userId) => {
            jest.clearAllMocks();

            const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt);
            const returned = sorted.slice(0, 50);
            const unreadCount = notifications.filter(n => !n.read).length;

            prisma.notification.findMany.mockResolvedValue(returned);
            prisma.notification.count.mockResolvedValue(unreadCount);

            const res = await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.unreadCount).toBe(unreadCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Prisma findMany is called with take: 50 and orderBy createdAt desc', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          async (userId) => {
            jest.clearAllMocks();

            prisma.notification.findMany.mockResolvedValue([]);
            prisma.notification.count.mockResolvedValue(0);

            await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
            const call = prisma.notification.findMany.mock.calls[0][0];
            expect(call.where.userId).toBe(userId);
            expect(call.orderBy).toEqual({ createdAt: 'desc' });
            expect(call.take).toBe(50);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Prisma count is called with userId and read: false for unread count', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          async (userId) => {
            jest.clearAllMocks();

            prisma.notification.findMany.mockResolvedValue([]);
            prisma.notification.count.mockResolvedValue(0);

            await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(prisma.notification.count).toHaveBeenCalledTimes(1);
            const call = prisma.notification.count.mock.calls[0][0];
            expect(call.where.userId).toBe(userId);
            expect(call.where.read).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each returned notification includes required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          notificationListArb,
          userIdArb,
          async (notifications, userId) => {
            fc.pre(notifications.length > 0);
            jest.clearAllMocks();

            const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt);
            const returned = sorted.slice(0, 50);
            const unreadCount = notifications.filter(n => !n.read).length;

            prisma.notification.findMany.mockResolvedValue(returned);
            prisma.notification.count.mockResolvedValue(unreadCount);

            const res = await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            for (const notif of res.body.notifications) {
              expect(notif).toHaveProperty('id');
              expect(notif).toHaveProperty('type');
              expect(notif).toHaveProperty('message');
              expect(notif).toHaveProperty('read');
              expect(notif).toHaveProperty('createdAt');
              // relatedTaskId may be null but should be present
              expect('relatedTaskId' in notif).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 15: Mark-all-read updates all unread notifications
   *
   * For any user with a mix of read and unread notifications, marking all as read
   * SHALL set every notification's read status to true, and a subsequent retrieval
   * SHALL show unreadCount of 0.
   *
   * **Validates: Requirements 8.4**
   */
  describe('Property 15: Mark-all-read updates all unread notifications', () => {
    it('mark-all-read calls updateMany with userId and read: false filter', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          async (userId) => {
            jest.clearAllMocks();

            prisma.notification.updateMany.mockResolvedValue({ count: 5 });

            const res = await request(app)
              .put('/notifications/read-all')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
            const call = prisma.notification.updateMany.mock.calls[0][0];
            expect(call.where.userId).toBe(userId);
            expect(call.where.read).toBe(false);
            expect(call.data.read).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('mark-all-read targets only unread notifications of the authenticated user', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.integer({ min: 0, max: 100 }),
          async (userId, unreadCount) => {
            jest.clearAllMocks();

            prisma.notification.updateMany.mockResolvedValue({ count: unreadCount });

            const res = await request(app)
              .put('/notifications/read-all')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            // Verify the where clause targets only the current user's unread notifications
            const call = prisma.notification.updateMany.mock.calls[0][0];
            expect(call.where.userId).toBe(userId);
            expect(call.where.read).toBe(false);
            // The data sets read to true
            expect(call.data).toEqual({ read: true });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('after mark-all-read, subsequent retrieval shows unreadCount of 0', async () => {
      await fc.assert(
        fc.asyncProperty(
          notificationListArb,
          userIdArb,
          async (notifications, userId) => {
            jest.clearAllMocks();

            // First: mark all as read
            prisma.notification.updateMany.mockResolvedValue({
              count: notifications.filter(n => !n.read).length,
            });

            const markRes = await request(app)
              .put('/notifications/read-all')
              .set('x-test-user-id', userId);

            expect(markRes.status).toBe(200);

            // Second: retrieve — all notifications are now read
            jest.clearAllMocks();
            const allRead = notifications.map(n => ({ ...n, read: true }));
            const sorted = [...allRead].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);

            prisma.notification.findMany.mockResolvedValue(sorted);
            prisma.notification.count.mockResolvedValue(0); // All are read now

            const getRes = await request(app)
              .get('/notifications')
              .set('x-test-user-id', userId);

            expect(getRes.status).toBe(200);
            expect(getRes.body.unreadCount).toBe(0);
            // All returned notifications should have read: true
            for (const notif of getRes.body.notifications) {
              expect(notif.read).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('mark-all-read succeeds even when there are no unread notifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          async (userId) => {
            jest.clearAllMocks();

            // No unread notifications to update
            prisma.notification.updateMany.mockResolvedValue({ count: 0 });

            const res = await request(app)
              .put('/notifications/read-all')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('All notifications marked as read');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('mark-all-read returns success confirmation message', async () => {
      await fc.assert(
        fc.asyncProperty(
          userIdArb,
          fc.integer({ min: 0, max: 50 }),
          async (userId, count) => {
            jest.clearAllMocks();

            prisma.notification.updateMany.mockResolvedValue({ count });

            const res = await request(app)
              .put('/notifications/read-all')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('message');
            expect(typeof res.body.message).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
