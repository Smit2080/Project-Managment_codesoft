const fc = require('fast-check');
const express = require('express');
const request = require('supertest');
const { securityHeaders } = require('../../src/middleware/securityHeaders');
const { errorHandler } = require('../../src/middleware/errorHandler');

/**
 * Property Tests for Security Headers and Error Handling
 *
 * Property 25: Security headers present on all responses
 * Property 27: Error responses use consistent format without internal details
 *
 * **Validates: Requirements 13.6, 13.7, 17.1, 17.2, 17.5**
 */

// --- Test App Helpers ---

/**
 * Creates a test Express app with the security headers middleware and
 * various route types to test header presence on all responses.
 */
function createSecurityApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json());

  // Success routes for different HTTP methods
  app.get('/api/test', (req, res) => res.json({ ok: true }));
  app.post('/api/test', (req, res) => res.status(201).json({ created: true }));
  app.put('/api/test', (req, res) => res.json({ updated: true }));
  app.delete('/api/test', (req, res) => res.status(204).send());
  app.patch('/api/test', (req, res) => res.json({ patched: true }));

  // Route that returns various status codes
  app.get('/api/status/:code', (req, res) => {
    const code = parseInt(req.params.code, 10);
    res.status(code).json({ status: code });
  });

  // Route that throws an error
  app.get('/api/error', (req, res, next) => {
    next(new Error('Something went wrong'));
  });

  // Route that throws specific error types
  app.get('/api/error/:type', (req, res, next) => {
    const { type } = req.params;
    if (type === 'zod') {
      const err = { name: 'ZodError', errors: [{ path: ['field'], message: 'Required' }], stack: 's', message: 'z' };
      return next(err);
    }
    if (type === 'prisma-unique') {
      const err = { code: 'P2002', message: 'Unique constraint', stack: 's' };
      return next(err);
    }
    if (type === 'prisma-notfound') {
      const err = { code: 'P2025', message: 'Record not found', stack: 's' };
      return next(err);
    }
    if (type === 'jwt-expired') {
      const err = { name: 'TokenExpiredError', message: 'jwt expired', stack: 's' };
      return next(err);
    }
    if (type === 'jwt-invalid') {
      const err = { name: 'JsonWebTokenError', message: 'invalid signature', stack: 's' };
      return next(err);
    }
    if (type === 'payload-large') {
      const err = { type: 'entity.too.large', message: 'too large', stack: 's' };
      return next(err);
    }
    if (type === 'multer') {
      const err = { name: 'MulterError', message: 'File too large', stack: 's' };
      return next(err);
    }
    if (type === 'forbidden') {
      const err = new Error('Insufficient permissions');
      err.statusCode = 403;
      err.name = 'ForbiddenError';
      return next(err);
    }
    next(new Error('Unknown error type'));
  });

  app.use(errorHandler);
  return app;
}

/**
 * Creates a test app specifically for error handler production mode testing.
 */
function createProductionErrorApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json());

  // Route that throws errors with internal details
  app.post('/api/trigger-error', (req, res, next) => {
    const { errorType, message } = req.body || {};
    const err = new Error(message || 'Internal failure');
    if (errorType === 'with-stack') {
      err.stack = 'Error: at /app/server/src/routes/auth.js:42:13\n  at processTicksAndRejections';
    }
    if (errorType === 'with-db-info') {
      err.message = 'Connection failed: postgres://admin:secret@db.internal:5432/mydb';
    }
    if (errorType === 'with-filepath') {
      err.message = 'ENOENT: no such file or directory /var/app/server/src/config/secrets.json';
    }
    if (errorType === 'with-env-vars') {
      err.message = 'Missing DATABASE_URL=postgres://user:pass@host/db';
    }
    next(err);
  });

  // Prisma errors that should not expose table/constraint names
  app.post('/api/trigger-prisma-error', (req, res, next) => {
    const { code, meta } = req.body || {};
    const err = {
      name: 'PrismaClientKnownRequestError',
      code: code || 'P2002',
      message: `Unique constraint failed on the constraint: \`User_email_key\``,
      meta: meta || { target: ['email'] },
      stack: 'PrismaClient stack at /app/node_modules/.prisma/client/runtime/library.js:123',
    };
    next(err);
  });

  app.use(errorHandler);
  return app;
}

// --- Generators ---

// HTTP methods to test
const httpMethodArb = fc.constantFrom('get', 'post', 'put', 'delete', 'patch');

// Various route paths that exist in the test app
const routePathArb = fc.constantFrom(
  '/api/test',
  '/api/status/200',
  '/api/status/201',
  '/api/status/301',
  '/api/status/400',
  '/api/status/404',
  '/api/status/500'
);

// Error types available in the test app
const errorTypeArb = fc.constantFrom(
  'zod',
  'prisma-unique',
  'prisma-notfound',
  'jwt-expired',
  'jwt-invalid',
  'payload-large',
  'multer',
  'forbidden'
);

// Random strings that could appear as internal details
const internalDetailStringArb = fc.oneof(
  fc.constant('Database connection failed: postgres://user:pass@host/db'),
  fc.constant('Error at /app/server/src/routes/auth.js:42:13'),
  fc.constant('ENOENT: /var/app/config/secrets.json'),
  fc.constant('Missing JWT_SECRET environment variable'),
  fc.constant('Unique constraint failed on User_email_key'),
  fc.constant('Cannot read properties of null (reading "id") at Object.<anonymous> (/app/src/index.js:15:5)'),
  fc.constant('Connection refused ECONNREFUSED 127.0.0.1:5432'),
  fc.constant('MODULE_NOT_FOUND: Cannot find module "@prisma/client"')
);

// Patterns that should NEVER appear in production error responses
const sensitivePatterns = [
  /\.(js|ts|jsx|tsx):\d+/,    // file paths with line numbers
  /at\s+\w+\s*\(/,            // stack trace "at Function ("
  /node_modules/,              // dependency paths
  /postgres:\/\//,             // database connection strings
  /ENOENT|ECONNREFUSED/,      // system error codes
  /\/app\//,                   // absolute file paths
  /\/var\//,                   // system paths
  /\/src\//,                   // source paths
  /process\.env/,             // env references
  /secret|password|token/i,   // sensitive keywords in error messages (only for 500s)
];

describe('Property 25: Security headers present on all responses', () => {
  let app;

  beforeAll(() => {
    app = createSecurityApp();
  });

  /**
   * For any request to any route, the response SHALL include:
   * - X-Content-Type-Options: nosniff
   * - X-Frame-Options: DENY
   * - X-XSS-Protection: 0
   * - Content-Security-Policy: default-src 'self'
   * X-Powered-By header SHALL NOT be present.
   *
   * **Validates: Requirements 13.6, 13.7**
   */
  it('security headers are present on all successful responses regardless of HTTP method', async () => {
    await fc.assert(
      fc.asyncProperty(httpMethodArb, async (method) => {
        const res = await request(app)[method]('/api/test');

        // Required headers present with correct values
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-xss-protection']).toBe('0');
        expect(res.headers['content-security-policy']).toBe("default-src 'self'");

        // X-Powered-By must NOT be present
        expect(res.headers['x-powered-by']).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('security headers are present on responses with various status codes', async () => {
    const statusCodeArb = fc.constantFrom(200, 201, 204, 301, 400, 401, 403, 404, 422, 429, 500);

    await fc.assert(
      fc.asyncProperty(statusCodeArb, async (statusCode) => {
        const res = await request(app).get(`/api/status/${statusCode}`);

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-xss-protection']).toBe('0');
        expect(res.headers['content-security-policy']).toBe("default-src 'self'");
        expect(res.headers['x-powered-by']).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('security headers are present on error responses', async () => {
    await fc.assert(
      fc.asyncProperty(errorTypeArb, async (errorType) => {
        const res = await request(app).get(`/api/error/${errorType}`);

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-xss-protection']).toBe('0');
        expect(res.headers['content-security-policy']).toBe("default-src 'self'");
        expect(res.headers['x-powered-by']).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('security headers are present on unhandled 500 error responses', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 50 }), async () => {
        const res = await request(app).get('/api/error');

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-xss-protection']).toBe('0');
        expect(res.headers['content-security-policy']).toBe("default-src 'self'");
        expect(res.headers['x-powered-by']).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 27: Error responses use consistent format without internal details', () => {
  let app;
  let prodApp;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(() => {
    app = createSecurityApp();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  /**
   * For any error response (4xx or 5xx), the response SHALL contain exactly
   * { error, message, statusCode } fields. In production mode, the response
   * SHALL NOT contain stack traces, file paths, or database identifiers.
   *
   * **Validates: Requirements 17.1, 17.2, 17.5**
   */
  it('all error responses contain error, message, and statusCode fields', async () => {
    // Suppress console.error during tests
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(errorTypeArb, async (errorType) => {
        const res = await request(app).get(`/api/error/${errorType}`);

        // Must have the three required fields
        expect(res.body).toHaveProperty('error');
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('statusCode');

        // Types must be correct
        expect(typeof res.body.error).toBe('string');
        expect(typeof res.body.message).toBe('string');
        expect(typeof res.body.statusCode).toBe('number');

        // statusCode must match HTTP status
        expect(res.body.statusCode).toBe(res.status);

        // error and message must not be empty
        expect(res.body.error.length).toBeGreaterThan(0);
        expect(res.body.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('error responses have only expected fields (no extra leakage)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Allowed fields: error, message, statusCode, details (only for validation)
    const allowedFields = ['error', 'message', 'statusCode', 'details'];

    await fc.assert(
      fc.asyncProperty(errorTypeArb, async (errorType) => {
        const res = await request(app).get(`/api/error/${errorType}`);
        const bodyKeys = Object.keys(res.body);

        // All keys in body must be in allowed set
        for (const key of bodyKeys) {
          expect(allowedFields).toContain(key);
        }

        // 'details' is only allowed on ZodError (422)
        if (res.status !== 422) {
          expect(res.body.details).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('production 500 errors never expose internal details', async () => {
    process.env.NODE_ENV = 'production';
    const prodApp = createProductionErrorApp();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(internalDetailStringArb, async (errorMessage) => {
        const res = await request(prodApp)
          .post('/api/trigger-error')
          .send({ message: errorMessage });

        expect(res.status).toBe(500);

        const bodyStr = JSON.stringify(res.body);

        // Must not contain any sensitive patterns
        for (const pattern of sensitivePatterns) {
          expect(bodyStr).not.toMatch(pattern);
        }

        // Must have consistent format
        expect(res.body).toEqual({
          error: 'Internal Server Error',
          message: 'Something went wrong',
          statusCode: 500,
        });
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('production Prisma errors never expose table names, constraint names, or raw error codes', async () => {
    process.env.NODE_ENV = 'production';
    const prodApp = createProductionErrorApp();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const prismaErrorArb = fc.record({
      code: fc.constantFrom('P2002', 'P2025'),
      meta: fc.constantFrom(
        { target: ['email'] },
        { target: ['User_email_key'] },
        { cause: 'Record to update not found.' }
      ),
    });

    await fc.assert(
      fc.asyncProperty(prismaErrorArb, async ({ code, meta }) => {
        const res = await request(prodApp)
          .post('/api/trigger-prisma-error')
          .send({ code, meta });

        const bodyStr = JSON.stringify(res.body);

        // Must NOT contain raw Prisma error codes
        expect(bodyStr).not.toContain('P2002');
        expect(bodyStr).not.toContain('P2025');

        // Must NOT contain table/constraint names
        expect(bodyStr).not.toContain('User_email_key');
        expect(bodyStr).not.toMatch(/prisma/i);

        // Must have consistent format
        expect(res.body).toHaveProperty('error');
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('statusCode');
        expect(typeof res.body.error).toBe('string');
        expect(typeof res.body.message).toBe('string');
        expect(typeof res.body.statusCode).toBe('number');
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('production error responses never contain stack traces or file paths', async () => {
    process.env.NODE_ENV = 'production';
    const prodApp = createProductionErrorApp();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const errorTypeWithStackArb = fc.constantFrom(
      'with-stack',
      'with-db-info',
      'with-filepath',
      'with-env-vars'
    );

    await fc.assert(
      fc.asyncProperty(errorTypeWithStackArb, async (errorType) => {
        const res = await request(prodApp)
          .post('/api/trigger-error')
          .send({ errorType });

        expect(res.status).toBe(500);
        const bodyStr = JSON.stringify(res.body);

        // No stack traces
        expect(bodyStr).not.toMatch(/at\s+\w/);
        // No file paths
        expect(bodyStr).not.toMatch(/\.(js|ts):\d+/);
        expect(bodyStr).not.toMatch(/\/app\//);
        expect(bodyStr).not.toMatch(/\/var\//);
        expect(bodyStr).not.toMatch(/\/src\//);
        // No database strings
        expect(bodyStr).not.toMatch(/postgres:\/\//);
        // No env variable values
        expect(bodyStr).not.toMatch(/DATABASE_URL/);

        // Only contains the generic error response
        expect(res.body.error).toBe('Internal Server Error');
        expect(res.body.message).toBe('Something went wrong');
        expect(res.body.statusCode).toBe(500);
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });

  it('mapped errors (4xx) use consistent format without internal schema details', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mappedErrorTypeArb = fc.constantFrom(
      'zod',
      'prisma-unique',
      'prisma-notfound',
      'jwt-expired',
      'jwt-invalid',
      'payload-large',
      'multer',
      'forbidden'
    );

    await fc.assert(
      fc.asyncProperty(mappedErrorTypeArb, async (errorType) => {
        const res = await request(app).get(`/api/error/${errorType}`);

        // All responses must have consistent format
        expect(res.body).toHaveProperty('error');
        expect(res.body).toHaveProperty('message');
        expect(res.body).toHaveProperty('statusCode');

        // Status code in body matches HTTP status
        expect(res.body.statusCode).toBe(res.status);

        const bodyStr = JSON.stringify(res.body);

        // No raw Prisma error codes in the response
        expect(bodyStr).not.toMatch(/P\d{4}/);
        // No table/constraint names
        expect(bodyStr).not.toContain('User_email_key');
        // No raw stack traces
        expect(bodyStr).not.toMatch(/at\s+Object\./);
        expect(bodyStr).not.toMatch(/node_modules/);
      }),
      { numRuns: 100 }
    );

    consoleSpy.mockRestore();
  });
});
