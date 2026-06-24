const { corsOptions, getAllowedOrigins } = require('../../src/config/cors');

describe('CORS Configuration', () => {
  const originalEnv = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CORS_ORIGINS = originalEnv;
    } else {
      delete process.env.CORS_ORIGINS;
    }
  });

  describe('getAllowedOrigins', () => {
    it('returns default origin when CORS_ORIGINS is not set', () => {
      delete process.env.CORS_ORIGINS;
      const origins = getAllowedOrigins();
      expect(origins).toEqual(['http://localhost:5173']);
    });

    it('parses comma-separated CORS_ORIGINS env var', () => {
      process.env.CORS_ORIGINS = 'https://app.example.com,https://admin.example.com';
      const origins = getAllowedOrigins();
      expect(origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });

    it('trims whitespace from origins', () => {
      process.env.CORS_ORIGINS = ' https://app.example.com , https://admin.example.com ';
      const origins = getAllowedOrigins();
      expect(origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });

    it('filters out empty strings from origins', () => {
      process.env.CORS_ORIGINS = 'https://app.example.com,,https://admin.example.com,';
      const origins = getAllowedOrigins();
      expect(origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });
  });

  describe('corsOptions.origin', () => {
    it('allows requests with no origin (same-origin, server-to-server)', () => {
      const callback = jest.fn();
      corsOptions.origin(undefined, callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('allows requests from whitelisted origins', () => {
      delete process.env.CORS_ORIGINS;
      const callback = jest.fn();
      corsOptions.origin('http://localhost:5173', callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects requests from non-whitelisted origins by returning false', () => {
      delete process.env.CORS_ORIGINS;
      const callback = jest.fn();
      corsOptions.origin('http://evil.example.com', callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('uses CORS_ORIGINS env var for whitelist', () => {
      process.env.CORS_ORIGINS = 'https://myapp.com,https://admin.myapp.com';
      const callback = jest.fn();

      corsOptions.origin('https://myapp.com', callback);
      expect(callback).toHaveBeenCalledWith(null, true);

      callback.mockClear();
      corsOptions.origin('https://admin.myapp.com', callback);
      expect(callback).toHaveBeenCalledWith(null, true);

      callback.mockClear();
      corsOptions.origin('http://localhost:5173', callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });

  describe('corsOptions configuration', () => {
    it('restricts methods to GET, POST, PUT, DELETE, OPTIONS', () => {
      expect(corsOptions.methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
    });

    it('restricts allowed headers to Content-Type, Authorization, X-Requested-With', () => {
      expect(corsOptions.allowedHeaders).toEqual([
        'Content-Type',
        'Authorization',
        'X-Requested-With',
      ]);
    });

    it('returns 204 for preflight requests', () => {
      expect(corsOptions.optionsSuccessStatus).toBe(204);
    });
  });
});
