const { verifyToken } = require('../config/auth');
const prisma = require('../config/database');

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'No token provided', statusCode: 401 });
    }

    const token = header.split(' ')[1];

    // Validate token is not empty or whitespace-only
    if (!token || !token.trim()) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Malformed token', statusCode: 401 });
    }

    const decoded = verifyToken(token);

    // Check that decoded token contains a userId
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token payload', statusCode: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, displayName: true, avatarUrl: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'User not found', statusCode: 401 });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = auth;
