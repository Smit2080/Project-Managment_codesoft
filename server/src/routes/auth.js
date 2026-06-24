const { Router } = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { generateToken } = require('../config/auth');
const auth = require('../middleware/auth');
const { validate, sanitizeHtml } = require('../middleware/inputValidator');
const { logAudit } = require('../services/auditLogger');
const { authLimiter } = require('../middleware/rateLimiter');

const router = Router();

// --- Zod Schemas ---

// Password complexity: at least one uppercase, one lowercase, one digit
const passwordComplexityRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])/;

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(passwordComplexityRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one digit'),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(passwordComplexityRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one digit'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(passwordComplexityRegex, 'Password must contain at least one uppercase letter, one lowercase letter, and one digit'),
});

// --- Routes ---

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const data = req.body;

    // Sanitize displayName (HTML stripping)
    data.displayName = sanitizeHtml(data.displayName);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'Email already registered', statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: { email: data.email, passwordHash, displayName: data.displayName },
      select: { id: true, email: true, displayName: true },
    });

    const token = generateToken(user.id);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const data = req.body;

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      // Audit: login_failed
      logAudit({
        userId: 'anonymous',
        ip: req.ip,
        action: 'login_failed',
        resourceType: 'user',
        resourceId: data.email,
        outcome: 'failure',
      });
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials', statusCode: 401 });
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      // Audit: login_failed
      logAudit({
        userId: 'anonymous',
        ip: req.ip,
        action: 'login_failed',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'failure',
      });
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials', statusCode: 401 });
    }

    // Audit: login_success
    logAudit({
      userId: user.id,
      ip: req.ip,
      action: 'login_success',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'success',
    });

    const token = generateToken(user.id);
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl },
      token,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/me', auth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const data = req.body;

    // Sanitize displayName if provided
    if (data.displayName) {
      data.displayName = sanitizeHtml(data.displayName);
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, email: true, displayName: true, avatarUrl: true },
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/password', auth, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Current password is incorrect', statusCode: 401 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });

    // Audit: password_change
    logAudit({
      userId: req.user.id,
      ip: req.ip,
      action: 'password_change',
      resourceType: 'user',
      resourceId: req.user.id,
      outcome: 'success',
    });

    res.json({ message: 'Password changed' });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Delete any existing reset tokens for this user
      await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

      // Generate a 32-byte hex token
      const token = crypto.randomBytes(32).toString('hex');

      // Hash the token with sha256 for storage
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Store with 15-minute expiry
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      // Build the reset link using CORS_ORIGINS or default
      const originsEnv = process.env.CORS_ORIGINS;
      const frontendOrigin = originsEnv
        ? originsEnv.split(',')[0].trim()
        : 'http://localhost:5173';
      const resetLink = `${frontendOrigin}/reset-password?token=${token}`;

      console.log(`\n[PASSWORD RESET] Reset link for ${email}:\n${resetLink}\n`);

      // Audit: password_reset_requested
      logAudit({
        userId: user.id,
        ip: req.ip,
        action: 'password_reset_requested',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'success',
      });
    }

    // Always return 200 with generic message
    res.json({ message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;

    // Hash the provided token with sha256
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find matching non-expired, unused record
    const resetRecord = await prisma.passwordReset.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!resetRecord) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid or expired reset token',
        statusCode: 400,
      });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user password and mark token as used
    await prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash },
    });

    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    // Audit: password_reset_completed
    logAudit({
      userId: resetRecord.userId,
      ip: req.ip,
      action: 'password_reset_completed',
      resourceType: 'user',
      resourceId: resetRecord.userId,
      outcome: 'success',
    });

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
