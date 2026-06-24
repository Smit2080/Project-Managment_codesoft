/**
 * Test Helper Utilities
 *
 * Shared utilities for auth token generation, test app creation,
 * and mock database setup used across unit and property tests.
 */

const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-secret-for-unit-tests-32-characters-long!!';
const TEST_JWT_EXPIRES_IN = '7d';

/**
 * Generate a valid JWT token for testing purposes.
 * @param {string} userId - The user ID to encode in the token
 * @param {object} [options] - Optional overrides
 * @param {string} [options.secret] - Custom secret (defaults to TEST_JWT_SECRET)
 * @param {string} [options.expiresIn] - Custom expiration (defaults to '7d')
 * @returns {string} Signed JWT token
 */
function generateTestToken(userId, options = {}) {
  const secret = options.secret || TEST_JWT_SECRET;
  const expiresIn = options.expiresIn || TEST_JWT_EXPIRES_IN;
  return jwt.sign({ userId }, secret, { expiresIn });
}

/**
 * Generate an expired JWT token for testing rejection of expired tokens.
 * @param {string} userId
 * @returns {string} Expired JWT token
 */
function generateExpiredToken(userId) {
  return jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '-1h' });
}

/**
 * Generate a token signed with a different secret (invalid signature).
 * @param {string} userId
 * @returns {string} JWT token with wrong signature
 */
function generateWrongSecretToken(userId) {
  return jwt.sign({ userId }, 'wrong-secret-not-the-real-one-xxxxx', { expiresIn: '7d' });
}

/**
 * Create a test Express app with common middleware.
 * @param {Function|object} routes - Router or middleware to mount
 * @param {string} [mountPath='/'] - Path to mount the routes
 * @returns {express.Application}
 */
function createTestApp(routes, mountPath = '/') {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(mountPath, routes);

  // Add a default error handler
  const { errorHandler } = require('../../src/middleware/errorHandler');
  app.use(errorHandler);

  return app;
}

/**
 * Create a mock Prisma user object.
 * @param {object} [overrides] - Fields to override
 * @returns {object} Mock user record
 */
function createMockUser(overrides = {}) {
  return {
    id: overrides.id || 'user-' + Math.random().toString(36).slice(2, 10),
    email: overrides.email || `test-${Date.now()}@example.com`,
    displayName: overrides.displayName || 'Test User',
    passwordHash: overrides.passwordHash || '$2a$12$mockhash',
    avatarUrl: overrides.avatarUrl || null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
  };
}

/**
 * Create a mock project object.
 * @param {object} [overrides] - Fields to override
 * @returns {object} Mock project record
 */
function createMockProject(overrides = {}) {
  return {
    id: overrides.id || 'proj-' + Math.random().toString(36).slice(2, 10),
    name: overrides.name || 'Test Project',
    description: overrides.description || 'A test project',
    ownerId: overrides.ownerId || 'user-owner',
    archived: overrides.archived || false,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
  };
}

/**
 * Create a mock task object.
 * @param {object} [overrides] - Fields to override
 * @returns {object} Mock task record
 */
function createMockTask(overrides = {}) {
  return {
    id: overrides.id || 'task-' + Math.random().toString(36).slice(2, 10),
    title: overrides.title || 'Test Task',
    description: overrides.description || 'A test task description',
    status: overrides.status || 'todo',
    priority: overrides.priority || 'medium',
    projectId: overrides.projectId || 'proj-1',
    assigneeId: overrides.assigneeId || null,
    createdBy: overrides.createdBy || 'user-1',
    dueDate: overrides.dueDate || null,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
  };
}

/**
 * Create a mock project member object.
 * @param {object} [overrides] - Fields to override
 * @returns {object} Mock project member record
 */
function createMockProjectMember(overrides = {}) {
  return {
    id: overrides.id || 'pm-' + Math.random().toString(36).slice(2, 10),
    userId: overrides.userId || 'user-1',
    projectId: overrides.projectId || 'proj-1',
    role: overrides.role || 'member',
    createdAt: overrides.createdAt || new Date(),
  };
}

module.exports = {
  TEST_JWT_SECRET,
  TEST_JWT_EXPIRES_IN,
  generateTestToken,
  generateExpiredToken,
  generateWrongSecretToken,
  createTestApp,
  createMockUser,
  createMockProject,
  createMockTask,
  createMockProjectMember,
};
