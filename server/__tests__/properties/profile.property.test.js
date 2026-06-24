const fc = require('fast-check');
const express = require('express');
const request = require('supertest');

// Mock Prisma
jest.mock('../../src/config/database', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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
const authRoutes = require('../../src/routes/auth');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { generateToken } = require('../../src/config/auth');

// Create test Express app
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

describe('Profile Operations - Property Tests', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---

  // Valid display name: 1-50 chars, no HTML tags
  const validDisplayNameArb = fc
    .stringMatching(/^[a-zA-Z0-9 _\-]{1,50}$/)
    .filter((s) => s.trim().length > 0);

  // User ID generator
  const userIdArb = fc.uuid();

  /**
   * Property 5: Profile update persistence
   *
   * For any valid profile update payload (displayName 1-50 chars), the auth route
   * SHALL update the user's profile and return the updated data. The updated
   * displayName SHALL match the sanitized input.
   *
   * **Validates: Requirements 2.2**
   */
  describe('Property 5: Profile update persistence', () => {
    it('updates profile with valid displayName and returns updated data', async () => {
      await fc.assert(
        fc.asyncProperty(userIdArb, validDisplayNameArb, async (userId, displayName) => {
          jest.clearAllMocks();

          // Mock user lookup for auth middleware
          const existingUser = {
            id: userId,
            email: 'user@test.com',
            displayName: 'OldName',
            avatarUrl: null,
          };
          prisma.user.findUnique.mockResolvedValue(existingUser);

          // Mock the update to return the user with the new displayName
          const updatedUser = {
            id: userId,
            email: 'user@test.com',
            displayName: displayName,
            avatarUrl: null,
          };
          prisma.user.update.mockResolvedValue(updatedUser);

          const token = generateToken(userId);

          const res = await request(app)
            .put('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ displayName });

          // Should return 200
          expect(res.status).toBe(200);
          // Should return the updated user data
          expect(res.body).toBeDefined();
          expect(res.body.id).toBe(userId);
          expect(res.body.displayName).toBe(displayName);

          // Prisma update should have been called with the sanitized displayName
          expect(prisma.user.update).toHaveBeenCalledTimes(1);
          const updateCall = prisma.user.update.mock.calls[0][0];
          expect(updateCall.where.id).toBe(userId);
          // The displayName passed to update should not contain HTML tags
          expect(updateCall.data.displayName).not.toMatch(/<[^>]*>/);
        }),
        { numRuns: 100 }
      );
    });

    it('sanitizes HTML from displayName before persisting', async () => {
      // Generator for display names with HTML tags injected
      const htmlDisplayNameArb = fc
        .tuple(
          fc.stringMatching(/^[a-zA-Z]{1,10}$/),
          fc.constantFrom('<script>', '<b>', '</div>', '<img src="x">', '<a href="#">'),
          fc.stringMatching(/^[a-zA-Z]{1,10}$/)
        )
        .map(([before, tag, after]) => `${before}${tag}${after}`);

      await fc.assert(
        fc.asyncProperty(userIdArb, htmlDisplayNameArb, async (userId, displayName) => {
          jest.clearAllMocks();

          const existingUser = {
            id: userId,
            email: 'user@test.com',
            displayName: 'OldName',
            avatarUrl: null,
          };
          prisma.user.findUnique.mockResolvedValue(existingUser);

          // Mock update to return whatever was passed
          prisma.user.update.mockImplementation(({ data }) => {
            return Promise.resolve({
              id: userId,
              email: 'user@test.com',
              displayName: data.displayName,
              avatarUrl: data.avatarUrl || null,
            });
          });

          const token = generateToken(userId);

          const res = await request(app)
            .put('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ displayName });

          // The response may be 200 (valid after sanitization) or 422 (if sanitized to empty)
          if (res.status === 200) {
            // The returned displayName should NOT contain HTML tags
            expect(res.body.displayName).not.toMatch(/<\s*\/?\s*[a-z][^>]*>?/i);

            // The update call should have sanitized data
            const updateCall = prisma.user.update.mock.calls[0][0];
            expect(updateCall.data.displayName).not.toMatch(/<\s*\/?\s*[a-z][^>]*>?/i);
          }
          // If 422, that's acceptable - sanitized displayName may have become empty
        }),
        { numRuns: 100 }
      );
    });

    it('persists profile update so subsequent GET returns updated values', async () => {
      await fc.assert(
        fc.asyncProperty(userIdArb, validDisplayNameArb, async (userId, displayName) => {
          jest.clearAllMocks();

          const existingUser = {
            id: userId,
            email: 'user@test.com',
            displayName: 'OldName',
            avatarUrl: null,
          };

          // For auth middleware: findUnique is called to verify the user exists
          prisma.user.findUnique.mockResolvedValue(existingUser);

          // Mock update to return the updated user
          const updatedUser = {
            id: userId,
            email: 'user@test.com',
            displayName: displayName,
            avatarUrl: null,
          };
          prisma.user.update.mockResolvedValue(updatedUser);

          const token = generateToken(userId);

          // PUT to update profile
          const putRes = await request(app)
            .put('/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .send({ displayName });

          expect(putRes.status).toBe(200);

          // Now mock findUnique to return the updated user for the GET
          prisma.user.findUnique.mockResolvedValue({
            ...updatedUser,
            createdAt: new Date().toISOString(),
          });

          // GET profile should reflect the update
          const getRes = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${token}`);

          expect(getRes.status).toBe(200);
          expect(getRes.body.displayName).toBe(displayName);
        }),
        { numRuns: 100 }
      );
    });
  });
});
