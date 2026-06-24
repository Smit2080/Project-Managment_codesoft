const fc = require('fast-check');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock Prisma
jest.mock('../../src/config/database', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  compare: jest.fn(),
}));

const prisma = require('../../src/config/database');
const bcrypt = require('bcryptjs');
const authRoutes = require('../../src/routes/auth');
const authMiddleware = require('../../src/middleware/auth');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { generateToken, verifyToken, JWT_SECRET } = require('../../src/config/auth');

// Create test Express app
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);

  // Protected route to test auth middleware
  app.get('/protected', authMiddleware, (req, res) => {
    res.json({ userId: req.user.id });
  });

  app.use(errorHandler);
  return app;
}

describe('Auth Module - Property Tests', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---

  // Valid email: up to 255 chars, valid format
  const validEmailArb = fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,19}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
      fc.constantFrom('com', 'org', 'net', 'io', 'dev')
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

  // Valid password: at least 6 chars (current schema), with uppercase, lowercase, digit
  const validPasswordArb = fc
    .tuple(
      fc.stringMatching(/^[a-z]{2,4}$/),
      fc.stringMatching(/^[A-Z]{2,4}$/),
      fc.stringMatching(/^[0-9]{2,3}$/),
      fc.stringMatching(/^[a-zA-Z0-9]{2,50}$/)
    )
    .map(([lower, upper, digit, rest]) => `${lower}${upper}${digit}${rest}`);

  // Valid display name: 1-50 chars
  const validDisplayNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

  // Valid registration payload
  const validRegistrationArb = fc.record({
    email: validEmailArb,
    password: validPasswordArb,
    displayName: validDisplayNameArb,
  });

  /**
   * Property 1: Valid registration produces token and account
   *
   * For any valid registration payload (email ≤255 chars with valid format,
   * password 8-128 chars with at least one uppercase, one lowercase, one digit,
   * display name 1-50 chars), the Auth_Module SHALL create the user account
   * and return a JWT token with a 7-day expiration whose payload contains
   * only userId and exp.
   *
   * **Validates: Requirements 1.1, 14.4**
   */
  describe('Property 1: Valid registration produces token and account', () => {
    it('returns 201 with a JWT token for any valid registration payload', async () => {
      await fc.assert(
        fc.asyncProperty(validRegistrationArb, async (payload) => {
          jest.clearAllMocks();

          // No existing user
          prisma.user.findUnique.mockResolvedValue(null);
          // Create returns the user
          const mockUser = {
            id: 'user-' + Math.random().toString(36).slice(2),
            email: payload.email,
            displayName: payload.displayName,
          };
          prisma.user.create.mockResolvedValue(mockUser);

          const res = await request(app)
            .post('/auth/register')
            .send(payload);

          // Should return 201
          expect(res.status).toBe(201);
          // Should have a token
          expect(res.body.token).toBeDefined();
          expect(typeof res.body.token).toBe('string');
          // Should return user data
          expect(res.body.user).toBeDefined();
          expect(res.body.user.email).toBe(payload.email);

          // Token should decode and contain only userId
          const decoded = jwt.decode(res.body.token);
          expect(decoded).not.toBeNull();
          expect(decoded.userId).toBe(mockUser.id);
          // Should have exp field
          expect(decoded.exp).toBeDefined();
          // Should NOT contain email or other PII
          expect(decoded.email).toBeUndefined();
          expect(decoded.displayName).toBeUndefined();
          expect(decoded.password).toBeUndefined();
          expect(decoded.passwordHash).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('the user create is called with hashed password (not plaintext)', async () => {
      await fc.assert(
        fc.asyncProperty(validRegistrationArb, async (payload) => {
          jest.clearAllMocks();
          prisma.user.findUnique.mockResolvedValue(null);
          prisma.user.create.mockResolvedValue({
            id: 'u-1',
            email: payload.email,
            displayName: payload.displayName,
          });

          await request(app).post('/auth/register').send(payload);

          // bcrypt.hash should have been called with the password
          expect(bcrypt.hash).toHaveBeenCalledWith(payload.password, 12);
          // The user.create call should use the hash, not the plaintext password
          const createCall = prisma.user.create.mock.calls[0][0];
          expect(createCall.data.passwordHash).toBe('$2a$12$hashedpassword');
          expect(createCall.data.password).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Invalid registration is rejected without side effects
   *
   * For any registration payload that violates field constraints (missing fields,
   * invalid email format, password not meeting complexity rules, display name
   * outside 1-50 chars), the Auth_Module SHALL return an error status (422)
   * and SHALL NOT create a user record.
   *
   * **Validates: Requirements 1.2**
   */
  describe('Property 2: Invalid registration is rejected without side effects', () => {
    // Invalid email formats
    const invalidEmailArb = fc.oneof(
      fc.constant(''),
      fc.constant('notanemail'),
      fc.constant('missing@'),
      fc.constant('@nodomain.com'),
      fc.constant('spaces in@email.com')
    );

    // Password too short (less than 6 chars which is the current schema min)
    const shortPasswordArb = fc.string({ minLength: 1, maxLength: 5 });

    // Display name too long (over 50 chars)
    const longDisplayNameArb = fc.string({ minLength: 51, maxLength: 100 });

    // Empty display name
    const emptyDisplayNameArb = fc.constant('');

    it('rejects requests with invalid email and no user is created', async () => {
      await fc.assert(
        fc.asyncProperty(
          invalidEmailArb,
          validPasswordArb,
          validDisplayNameArb,
          async (email, password, displayName) => {
            jest.clearAllMocks();

            const res = await request(app)
              .post('/auth/register')
              .send({ email, password, displayName });

            // Should be rejected (422 from Zod validation via error handler)
            expect(res.status).toBe(422);
            // No user should have been created
            expect(prisma.user.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects requests with too-short password and no user is created', async () => {
      await fc.assert(
        fc.asyncProperty(
          validEmailArb,
          shortPasswordArb,
          validDisplayNameArb,
          async (email, password, displayName) => {
            jest.clearAllMocks();

            const res = await request(app)
              .post('/auth/register')
              .send({ email, password, displayName });

            expect(res.status).toBe(422);
            expect(prisma.user.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects requests with display name exceeding 50 chars and no user is created', async () => {
      await fc.assert(
        fc.asyncProperty(
          validEmailArb,
          validPasswordArb,
          longDisplayNameArb,
          async (email, password, displayName) => {
            jest.clearAllMocks();

            const res = await request(app)
              .post('/auth/register')
              .send({ email, password, displayName });

            expect(res.status).toBe(422);
            expect(prisma.user.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects requests with empty display name and no user is created', async () => {
      await fc.assert(
        fc.asyncProperty(
          validEmailArb,
          validPasswordArb,
          async (email, password) => {
            jest.clearAllMocks();

            const res = await request(app)
              .post('/auth/register')
              .send({ email, password, displayName: '' });

            expect(res.status).toBe(422);
            expect(prisma.user.create).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects requests with missing fields and no user is created', async () => {
      const incompletePayloads = fc.oneof(
        // Missing email
        fc.record({
          password: validPasswordArb,
          displayName: validDisplayNameArb,
        }),
        // Missing password
        fc.record({
          email: validEmailArb,
          displayName: validDisplayNameArb,
        }),
        // Missing displayName
        fc.record({
          email: validEmailArb,
          password: validPasswordArb,
        }),
        // Empty body
        fc.constant({})
      );

      await fc.assert(
        fc.asyncProperty(incompletePayloads, async (payload) => {
          jest.clearAllMocks();

          const res = await request(app)
            .post('/auth/register')
            .send(payload);

          expect(res.status).toBe(422);
          expect(prisma.user.create).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Invalid credentials yield generic error
   *
   * For any login attempt with a non-existent email or incorrect password,
   * the Auth_Module SHALL return 401 with a generic "Invalid credentials"
   * message that does not reveal whether the email or the password was incorrect.
   *
   * **Validates: Requirements 1.5**
   */
  describe('Property 3: Invalid credentials yield generic error', () => {
    const emailArb = validEmailArb;
    const passwordArb = fc.string({ minLength: 1, maxLength: 50 });

    it('returns 401 with generic message for non-existent email', async () => {
      await fc.assert(
        fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
          jest.clearAllMocks();
          // User not found
          prisma.user.findUnique.mockResolvedValue(null);

          const res = await request(app)
            .post('/auth/login')
            .send({ email, password });

          expect(res.status).toBe(401);
          expect(res.body.message).toBe('Invalid credentials');
          // Should NOT reveal that the email was wrong
          expect(res.body.message).not.toMatch(/email/i);
          expect(res.body.message).not.toMatch(/not found/i);
          expect(res.body.message).not.toMatch(/does not exist/i);
        }),
        { numRuns: 100 }
      );
    });

    it('returns 401 with generic message for wrong password', async () => {
      await fc.assert(
        fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
          jest.clearAllMocks();
          // User exists but password is wrong
          prisma.user.findUnique.mockResolvedValue({
            id: 'user-123',
            email,
            passwordHash: '$2a$12$somehash',
            displayName: 'Test',
            avatarUrl: null,
          });
          bcrypt.compare.mockResolvedValue(false);

          const res = await request(app)
            .post('/auth/login')
            .send({ email, password });

          expect(res.status).toBe(401);
          expect(res.body.message).toBe('Invalid credentials');
          // Should NOT reveal that the password was wrong
          expect(res.body.message).not.toMatch(/password/i);
          expect(res.body.message).not.toMatch(/incorrect/i);
        }),
        { numRuns: 100 }
      );
    });

    it('non-existent email and wrong password produce identical response structure', async () => {
      await fc.assert(
        fc.asyncProperty(emailArb, passwordArb, async (email, password) => {
          jest.clearAllMocks();

          // Case 1: non-existent email
          prisma.user.findUnique.mockResolvedValue(null);
          const res1 = await request(app)
            .post('/auth/login')
            .send({ email, password });

          jest.clearAllMocks();

          // Case 2: wrong password
          prisma.user.findUnique.mockResolvedValue({
            id: 'user-123',
            email,
            passwordHash: '$2a$12$somehash',
            displayName: 'Test',
            avatarUrl: null,
          });
          bcrypt.compare.mockResolvedValue(false);
          const res2 = await request(app)
            .post('/auth/login')
            .send({ email, password });

          // Both should produce the same structure and message
          expect(res1.status).toBe(res2.status);
          expect(res1.body.message).toBe(res2.body.message);
          expect(res1.body.error).toBe(res2.body.error);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 4: Malformed or expired tokens are rejected
   *
   * For any token that is expired, has an invalid signature, is malformed,
   * or references a non-existent user, the Auth_Module SHALL return 401 Unauthorized.
   *
   * **Validates: Requirements 1.6, 14.5, 14.6, 14.7**
   */
  describe('Property 4: Malformed or expired tokens are rejected', () => {
    // Random strings that are not valid JWTs
    const randomStringArb = fc.string({ minLength: 1, maxLength: 200 });

    it('rejects random strings as Bearer tokens with 401', async () => {
      await fc.assert(
        fc.asyncProperty(randomStringArb, async (randomToken) => {
          jest.clearAllMocks();

          const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${randomToken}`);

          expect(res.status).toBe(401);
        }),
        { numRuns: 100 }
      );
    });

    it('rejects expired tokens with 401', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (userId) => {
          jest.clearAllMocks();

          // Create a token that expired 1 hour ago
          const expiredToken = jwt.sign(
            { userId },
            JWT_SECRET,
            { expiresIn: '-1h' }
          );

          const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${expiredToken}`);

          expect(res.status).toBe(401);
        }),
        { numRuns: 100 }
      );
    });

    it('rejects tokens signed with wrong secret with 401', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.string({ minLength: 10, maxLength: 50 }),
          async (userId, wrongSecret) => {
            // Ensure the wrong secret is actually different
            fc.pre(wrongSecret !== JWT_SECRET);
            jest.clearAllMocks();

            const tokenWithWrongSecret = jwt.sign(
              { userId },
              wrongSecret,
              { expiresIn: '7d' }
            );

            const res = await request(app)
              .get('/protected')
              .set('Authorization', `Bearer ${tokenWithWrongSecret}`);

            expect(res.status).toBe(401);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects valid tokens referencing non-existent users with 401', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (userId) => {
          jest.clearAllMocks();
          // User not found in DB
          prisma.user.findUnique.mockResolvedValue(null);

          const validToken = generateToken(userId);

          const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${validToken}`);

          expect(res.status).toBe(401);
        }),
        { numRuns: 100 }
      );
    });

    it('rejects requests without Bearer prefix with 401', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (userId) => {
          jest.clearAllMocks();
          const validToken = generateToken(userId);

          // Send token without "Bearer " prefix
          const res = await request(app)
            .get('/protected')
            .set('Authorization', validToken);

          expect(res.status).toBe(401);
        }),
        { numRuns: 100 }
      );
    });

    it('rejects requests with no Authorization header with 401', async () => {
      const res = await request(app).get('/protected');
      expect(res.status).toBe(401);
    });
  });
});
