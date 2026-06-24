const {
  rateLimiter,
  authLimiter,
  apiLimiter,
  _getStore,
  _clearStore,
} = require('../../src/middleware/rateLimiter');

// Helper to create mock req/res/next
function createMocks(overrides = {}) {
  const req = {
    ip: '127.0.0.1',
    user: null,
    ...overrides,
  };
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('rateLimiter middleware', () => {
  beforeEach(() => {
    _clearStore();
  });

  describe('basic sliding window behavior', () => {
    it('should allow requests under the limit', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      const { req, res, next } = createMocks();
      limiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it('should set rate limit headers on every response', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      const { req, res, next } = createMocks();
      limiter(req, res, next);

      expect(res.headers['X-RateLimit-Limit']).toBe(5);
      expect(res.headers['X-RateLimit-Remaining']).toBe(4);
      expect(res.headers['X-RateLimit-Reset']).toBeDefined();
      expect(typeof res.headers['X-RateLimit-Reset']).toBe('number');
    });

    it('should decrement remaining count with each request', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      // First request
      const mock1 = createMocks();
      limiter(mock1.req, mock1.res, mock1.next);
      expect(mock1.res.headers['X-RateLimit-Remaining']).toBe(2);

      // Second request
      const mock2 = createMocks();
      limiter(mock2.req, mock2.res, mock2.next);
      expect(mock2.res.headers['X-RateLimit-Remaining']).toBe(1);

      // Third request
      const mock3 = createMocks();
      limiter(mock3.req, mock3.res, mock3.next);
      expect(mock3.res.headers['X-RateLimit-Remaining']).toBe(0);
    });

    it('should return 429 when limit is exceeded', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      // Use up the limit
      const mock1 = createMocks();
      limiter(mock1.req, mock1.res, mock1.next);
      const mock2 = createMocks();
      limiter(mock2.req, mock2.res, mock2.next);

      // Third request should be rejected
      const mock3 = createMocks();
      limiter(mock3.req, mock3.res, mock3.next);

      expect(mock3.res.statusCode).toBe(429);
      expect(mock3.next).not.toHaveBeenCalled();
      expect(mock3.res.body).toEqual({
        error: 'Too Many Requests',
        message: 'Too many requests',
        statusCode: 429,
      });
    });

    it('should include Retry-After header when limit exceeded', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      // Use up the limit
      const mock1 = createMocks();
      limiter(mock1.req, mock1.res, mock1.next);

      // Second request should be rejected with Retry-After
      const mock2 = createMocks();
      limiter(mock2.req, mock2.res, mock2.next);

      expect(mock2.res.statusCode).toBe(429);
      expect(mock2.res.headers['Retry-After']).toBeDefined();
      expect(typeof mock2.res.headers['Retry-After']).toBe('number');
      expect(mock2.res.headers['Retry-After']).toBeGreaterThan(0);
      expect(mock2.res.headers['Retry-After']).toBeLessThanOrEqual(60);
    });

    it('should track different keys independently', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      // First IP hits limit
      const mock1 = createMocks({ ip: '1.1.1.1' });
      limiter(mock1.req, mock1.res, mock1.next);
      expect(mock1.next).toHaveBeenCalled();

      // First IP is now blocked
      const mock2 = createMocks({ ip: '1.1.1.1' });
      limiter(mock2.req, mock2.res, mock2.next);
      expect(mock2.res.statusCode).toBe(429);

      // Second IP can still make requests
      const mock3 = createMocks({ ip: '2.2.2.2' });
      limiter(mock3.req, mock3.res, mock3.next);
      expect(mock3.next).toHaveBeenCalled();
    });

    it('should expire old timestamps (sliding window)', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        keyGenerator: (req) => `test:${req.ip}`,
      });

      // Manually insert old timestamps that should be expired
      const store = _getStore();
      const now = Date.now();
      store.set('test:127.0.0.1', [now - 70000, now - 65000]); // Both older than 60s

      // Next request should succeed since old entries are cleaned up
      const { req, res, next } = createMocks();
      limiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Remaining']).toBe(1);
    });
  });

  describe('authLimiter', () => {
    it('should allow 5 requests per IP', () => {
      for (let i = 0; i < 5; i++) {
        const { req, res, next } = createMocks();
        authLimiter(req, res, next);
        expect(next).toHaveBeenCalled();
      }

      // 6th request should be blocked
      const { req, res, next } = createMocks();
      authLimiter(req, res, next);
      expect(res.statusCode).toBe(429);
    });

    it('should set X-RateLimit-Limit to 5', () => {
      const { req, res, next } = createMocks();
      authLimiter(req, res, next);
      expect(res.headers['X-RateLimit-Limit']).toBe(5);
    });
  });

  describe('apiLimiter', () => {
    it('should use userId key for authenticated users with limit of 100', () => {
      const { req, res, next } = createMocks({
        user: { id: 'user-123' },
      });
      apiLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe(100);
    });

    it('should use IP key for unauthenticated requests with limit of 20', () => {
      const { req, res, next } = createMocks({ user: null });
      apiLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe(20);
    });

    it('should block unauthenticated requests after 20 per IP', () => {
      for (let i = 0; i < 20; i++) {
        const { req, res, next } = createMocks({ user: null, ip: '10.0.0.1' });
        apiLimiter(req, res, next);
        expect(next).toHaveBeenCalled();
      }

      // 21st request should be blocked
      const { req, res, next } = createMocks({ user: null, ip: '10.0.0.1' });
      apiLimiter(req, res, next);
      expect(res.statusCode).toBe(429);
    });

    it('should allow authenticated users up to 100 requests', () => {
      for (let i = 0; i < 100; i++) {
        const { req, res, next } = createMocks({
          user: { id: 'user-abc' },
          ip: '10.0.0.2',
        });
        apiLimiter(req, res, next);
        expect(next).toHaveBeenCalled();
      }

      // 101st request should be blocked
      const { req, res, next } = createMocks({
        user: { id: 'user-abc' },
        ip: '10.0.0.2',
      });
      apiLimiter(req, res, next);
      expect(res.statusCode).toBe(429);
    });
  });

  describe('lazy cleanup', () => {
    it('should remove expired timestamps on each request', () => {
      const limiter = rateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        keyGenerator: (req) => `cleanup:${req.ip}`,
      });

      const store = _getStore();
      const now = Date.now();

      // Add a mix of expired and valid timestamps
      store.set('cleanup:127.0.0.1', [
        now - 120000, // expired (2 min ago)
        now - 90000,  // expired (1.5 min ago)
        now - 30000,  // valid (30s ago)
        now - 10000,  // valid (10s ago)
      ]);

      const { req, res, next } = createMocks();
      limiter(req, res, next);

      // After cleanup, only valid timestamps + new one should remain
      const updatedTimestamps = store.get('cleanup:127.0.0.1');
      expect(updatedTimestamps.length).toBe(3); // 2 valid + 1 new
    });
  });
});
