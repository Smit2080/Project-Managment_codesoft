const { errorHandler } = require('../../src/middleware/errorHandler');

// Helper to create a mock request
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    url: '/api/test',
    params: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

// Helper to create a mock response
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler middleware', () => {
  const originalEnv = process.env.NODE_ENV;
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    consoleSpy.mockRestore();
  });

  describe('server-side logging', () => {
    it('logs full error details including stack, code, and request context', () => {
      const err = new Error('test error');
      err.code = 'SOME_CODE';
      const req = mockReq({ method: 'POST', originalUrl: '/api/projects', params: { id: '123' } });
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logArg = consoleSpy.mock.calls[0][1];
      const parsed = JSON.parse(logArg);
      expect(parsed.error.stack).toBeDefined();
      expect(parsed.error.code).toBe('SOME_CODE');
      expect(parsed.request.method).toBe('POST');
      expect(parsed.request.path).toBe('/api/projects');
      expect(parsed.request.params).toEqual({ id: '123' });
    });
  });

  describe('ZodError handling', () => {
    it('returns 422 with field-level details', () => {
      const err = {
        name: 'ZodError',
        message: 'Validation failed',
        errors: [
          { path: ['name'], message: 'Required' },
          { path: ['email'], message: 'Invalid email' },
        ],
        stack: 'ZodError stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Validation Error',
        message: 'Invalid input data',
        details: [
          { field: 'name', message: 'Required' },
          { field: 'email', message: 'Invalid email' },
        ],
        statusCode: 422,
      });
    });
  });

  describe('Prisma error handling', () => {
    it('maps P2002 (unique constraint) to 409 without leaking table/constraint names', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        message: 'Unique constraint failed on the constraint: `User_email_key`',
        meta: { target: ['email'] },
        stack: 'PrismaClient stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual({
        error: 'Conflict',
        message: 'A record with this data already exists',
        statusCode: 409,
      });
      // Ensure no leaking of internal details
      expect(JSON.stringify(body)).not.toContain('User_email_key');
      expect(JSON.stringify(body)).not.toContain('P2002');
    });

    it('maps P2025 (record not found) to 404 without leaking table names', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
        message: 'An operation failed because it depends on one or more records that were required but not found.',
        meta: { cause: 'Record to update not found.' },
        stack: 'PrismaClient stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual({
        error: 'Not Found',
        message: 'The requested resource was not found',
        statusCode: 404,
      });
      expect(JSON.stringify(body)).not.toContain('Record to update');
    });

    it('maps P2016 (record not found) to 404', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2016',
        message: 'Query interpretation error.',
        stack: 'stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe('JWT error handling', () => {
    it('handles TokenExpiredError with 401', () => {
      const err = {
        name: 'TokenExpiredError',
        message: 'jwt expired',
        expiredAt: new Date(),
        stack: 'TokenExpiredError stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json.mock.calls[0][0]).toEqual({
        error: 'Unauthorized',
        message: 'Token has expired',
        statusCode: 401,
      });
    });

    it('handles JsonWebTokenError with 401', () => {
      const err = {
        name: 'JsonWebTokenError',
        message: 'invalid signature',
        stack: 'JsonWebTokenError stack...',
      };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json.mock.calls[0][0]).toEqual({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
    });
  });

  describe('payload too large', () => {
    it('handles entity.too.large type', () => {
      const err = { type: 'entity.too.large', message: 'request entity too large', stack: 'stack' };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json.mock.calls[0][0]).toEqual({
        error: 'Payload Too Large',
        message: 'Request body too large',
        statusCode: 413,
      });
    });

    it('handles err.status === 413', () => {
      const err = { status: 413, message: 'too large', stack: 'stack' };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(413);
    });
  });

  describe('MulterError handling', () => {
    it('returns 400 with error message', () => {
      const err = { name: 'MulterError', message: 'File too large', stack: 'stack' };
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0]).toEqual({
        error: 'Upload Error',
        message: 'File too large',
        statusCode: 400,
      });
    });
  });

  describe('production 500 errors', () => {
    it('suppresses internal details in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Database connection failed: postgres://user:pass@host/db');
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual({
        error: 'Internal Server Error',
        message: 'Something went wrong',
        statusCode: 500,
      });
      // Must not leak any internal details
      expect(JSON.stringify(body)).not.toContain('Database');
      expect(JSON.stringify(body)).not.toContain('postgres');
      expect(JSON.stringify(body)).not.toContain('stack');
    });

    it('does not include stack traces in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Unexpected failure');
      err.stack = 'Error: at /app/server/src/routes/auth.js:42:13';
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      const body = res.json.mock.calls[0][0];
      expect(JSON.stringify(body)).not.toContain('/app/server');
      expect(JSON.stringify(body)).not.toContain('.js');
    });
  });

  describe('development 500 errors', () => {
    it('includes error message in development for debugging', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('Something specific broke');
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      expect(body.message).toBe('Something specific broke');
      expect(body.error).toBe('Internal Server Error');
      expect(body.statusCode).toBe(500);
    });
  });

  describe('consistent error response format', () => {
    it('all error responses contain error, message, and statusCode fields', () => {
      const errors = [
        { name: 'ZodError', errors: [{ path: ['x'], message: 'req' }], stack: 's', message: 'z' },
        { code: 'P2002', message: 'unique', stack: 's' },
        { code: 'P2025', message: 'not found', stack: 's' },
        { name: 'TokenExpiredError', message: 'expired', stack: 's' },
        { name: 'JsonWebTokenError', message: 'invalid', stack: 's' },
        { type: 'entity.too.large', message: 'big', stack: 's' },
        { name: 'MulterError', message: 'upload err', stack: 's' },
        new Error('generic error'),
      ];

      for (const err of errors) {
        const req = mockReq();
        const res = mockRes();
        errorHandler(err, req, res, () => {});

        const body = res.json.mock.calls[0][0];
        expect(body).toHaveProperty('error');
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('statusCode');
        expect(typeof body.error).toBe('string');
        expect(typeof body.message).toBe('string');
        expect(typeof body.statusCode).toBe('number');
      }
    });
  });

  describe('non-500 errors with statusCode', () => {
    it('uses the error statusCode and message for non-500 errors', () => {
      const err = new Error('Insufficient permissions');
      err.statusCode = 403;
      err.name = 'ForbiddenError';
      const req = mockReq();
      const res = mockRes();

      errorHandler(err, req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0]).toEqual({
        error: 'ForbiddenError',
        message: 'Insufficient permissions',
        statusCode: 403,
      });
    });
  });
});
