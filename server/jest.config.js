/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.js',
    '<rootDir>/__tests__/**/*.property.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/prisma/**',
  ],
  coverageDirectory: 'coverage',
  // Increase timeout for property-based tests which run many iterations
  testTimeout: 30000,
};
