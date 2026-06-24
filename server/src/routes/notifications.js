const { Router } = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/inputValidator');

const router = Router();

// GET /api/notifications — return up to 50 most recent ordered by createdAt desc, include total unread count
router.get('/', auth, async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
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
      }),
      prisma.notification.count({
        where: { userId: req.user.id, read: false },
      }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/read-all — mark all user's unread notifications as read
router.put('/read-all', auth, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/:id/read — mark single as read, return 404 if not found, return 403 if not owner
router.put('/:id/read', auth, validateUuidParam('id'), async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Not Found', message: 'Notification not found', statusCode: 404 });
    }
    if (notification.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden', message: 'Not your notification', statusCode: 403 });
    }
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
