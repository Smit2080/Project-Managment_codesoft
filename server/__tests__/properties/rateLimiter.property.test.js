const fc = require('fast-check');
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
    connection: { remoteAddress: '127.0.0.1' },
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

describe('Rate Limiter - Property Tests', () => {
  beforeEach(() => {
    _clearStore();
  });

  /**
   * Property 21: Rate limiter sliding window enforcement
   *
   * For any client (identified by IP or userId), requests made more than
   * 60 seconds ago SHALL NOT count toward the current request limit.
   * The Nth+1 request within a 60-second sliding window (where N is the limit)
   * SHALL receive a 429 response with a Retry-After header.
   *
   * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
   */
  describe('Property 21: Rate limiter sliding window enforcement', () => {
    // Generator for rate limit configuration
    const limitConfigArb = fc.record({
      maxRequests: fc.integer({ min: 1, max: 50 }),
      ip: fc.ipV4(),
    });

    it('requests within limit always succeed (next is called)', () => {
      fc.assert(
        fc.property(limitConfigArb, ({ maxRequests, ip }) => {
          _clearStore();

          const limiter = rateLimiter({
            windowMs: 60000,
            maxRequests,
            keyGenerator: (req) => `prop21:${req.ip}`,
          });

          // Make exactly maxRequests requests - all should succeed
          for (let i = 0; i < maxRequests; i++) {
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);
            if (!next.mock.calls.length) {
              return false; // next was not called, fail the property
            }
            if (res.statusCode === 429) {
              return false; // should not be rate limited yet
            }
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('the (N+1)th request exceeding the limit receives 429 with Retry-After', () => {
      fc.assert(
        fc.property(limitConfigArb, ({ maxRequests, ip }) => {
          _clearStore();

          const limiter = rateLimiter({
            windowMs: 60000,
            maxRequests,
            keyGenerator: (req) => `prop21b:${req.ip}`,
          });

          // Exhaust the limit
          for (let i = 0; i < maxRequests; i++) {
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);
          }

          // The (N+1)th request should be rejected
          const { req, res, next } = createMocks({ ip });
          limiter(req, res, next);

          // Must receive 429
          if (res.statusCode !== 429) return false;
          // Must NOT call next
          if (next.mock.calls.length > 0) return false;
          // Must include Retry-After header
          if (!res.headers['Retry-After']) return false;
          // Retry-After must be a positive number <= 60
          if (res.headers['Retry-After'] <= 0 || res.headers['Retry-After'] > 60) return false;
          // Response body must contain error info
          if (res.body.statusCode !== 429) return false;

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('expired timestamps (older than 60s) do not count toward the limit', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // number of expired timestamps
          fc.integer({ min: 1, max: 20 }), // limit
          fc.ipV4(),
          (expiredCount, maxRequests, ip) => {
            _clearStore();

            const store = _getStore();
            const now = Date.now();
            const key = `prop21c:${ip}`;

            // Insert expired timestamps (older than 60 seconds)
            const expiredTimestamps = [];
            for (let i = 0; i < expiredCount; i++) {
              // Between 61 seconds and 120 seconds ago
              expiredTimestamps.push(now - 61000 - i * 1000);
            }
            store.set(key, expiredTimestamps);

            const limiter = rateLimiter({
              windowMs: 60000,
              maxRequests,
              keyGenerator: (req) => `prop21c:${req.ip}`,
            });

            // First request after expired entries should succeed
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);

            // Must succeed because expired timestamps are cleaned up
            if (!next.mock.calls.length) return false;
            if (res.statusCode === 429) return false;
            // Remaining should be maxRequests - 1 (only the new request counts)
            if (res.headers['X-RateLimit-Remaining'] !== maxRequests - 1) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('different keys are tracked independently', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // limit
          fc.ipV4(),
          fc.ipV4(),
          (maxRequests, ip1, ip2) => {
            // Ensure different IPs
            fc.pre(ip1 !== ip2);
            _clearStore();

            const limiter = rateLimiter({
              windowMs: 60000,
              maxRequests,
              keyGenerator: (req) => `prop21d:${req.ip}`,
            });

            // Exhaust the limit for ip1
            for (let i = 0; i < maxRequests; i++) {
              const { req, res, next } = createMocks({ ip: ip1 });
              limiter(req, res, next);
            }

            // ip1 should now be blocked
            const mock1 = createMocks({ ip: ip1 });
            limiter(mock1.req, mock1.res, mock1.next);
            if (mock1.res.statusCode !== 429) return false;

            // ip2 should still be able to make requests
            const mock2 = createMocks({ ip: ip2 });
            limiter(mock2.req, mock2.res, mock2.next);
            if (!mock2.next.mock.calls.length) return false;
            if (mock2.res.statusCode === 429) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('authLimiter enforces 5 req/min per IP', () => {
      fc.assert(
        fc.property(fc.ipV4(), (ip) => {
          _clearStore();

          // Make 5 requests (should all succeed)
          for (let i = 0; i < 5; i++) {
            const { req, res, next } = createMocks({ ip });
            authLimiter(req, res, next);
            if (!next.mock.calls.length) return false;
          }

          // 6th request should be blocked
          const { req, res, next } = createMocks({ ip });
          authLimiter(req, res, next);
          if (res.statusCode !== 429) return false;

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('apiLimiter uses userId for authenticated and IP for unauthenticated', () => {
      fc.assert(
        fc.property(
          fc.uuid(), // userId
          fc.ipV4(), // ip
          (userId, ip) => {
            _clearStore();

            // Authenticated request: should use 100 limit
            const authMock = createMocks({ ip, user: { id: userId } });
            apiLimiter(authMock.req, authMock.res, authMock.next);
            if (authMock.res.headers['X-RateLimit-Limit'] !== 100) return false;

            // Unauthenticated request from same IP: should use 20 limit
            const unauthMock = createMocks({ ip, user: null });
            apiLimiter(unauthMock.req, unauthMock.res, unauthMock.next);
            if (unauthMock.res.headers['X-RateLimit-Limit'] !== 20) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22: Rate limit response headers always present
   *
   * For any response from a rate-limited endpoint (success or 429),
   * the headers X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset
   * SHALL be present with correct numeric values.
   *
   * **Validates: Requirements 11.5**
   */
  describe('Property 22: Rate limit response headers always present', () => {
    // Generator for request count (some within limit, some over)
    const requestScenarioArb = fc.record({
      maxRequests: fc.integer({ min: 1, max: 30 }),
      requestCount: fc.integer({ min: 1, max: 40 }),
      ip: fc.ipV4(),
    });

    it('X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset are present on every response', () => {
      fc.assert(
        fc.property(requestScenarioArb, ({ maxRequests, requestCount, ip }) => {
          _clearStore();

          const limiter = rateLimiter({
            windowMs: 60000,
            maxRequests,
            keyGenerator: (req) => `prop22:${req.ip}`,
          });

          for (let i = 0; i < requestCount; i++) {
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);

            // All three headers must always be present
            if (res.headers['X-RateLimit-Limit'] === undefined) return false;
            if (res.headers['X-RateLimit-Remaining'] === undefined) return false;
            if (res.headers['X-RateLimit-Reset'] === undefined) return false;

            // X-RateLimit-Limit must equal the configured limit
            if (res.headers['X-RateLimit-Limit'] !== maxRequests) return false;

            // X-RateLimit-Remaining must be a non-negative number
            if (typeof res.headers['X-RateLimit-Remaining'] !== 'number') return false;
            if (res.headers['X-RateLimit-Remaining'] < 0) return false;

            // X-RateLimit-Reset must be a positive number (Unix timestamp in seconds)
            if (typeof res.headers['X-RateLimit-Reset'] !== 'number') return false;
            if (res.headers['X-RateLimit-Reset'] <= 0) return false;
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('X-RateLimit-Remaining decrements correctly for successful requests', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 30 }),
          fc.ipV4(),
          (maxRequests, ip) => {
            _clearStore();

            const limiter = rateLimiter({
              windowMs: 60000,
              maxRequests,
              keyGenerator: (req) => `prop22b:${req.ip}`,
            });

            for (let i = 0; i < maxRequests; i++) {
              const { req, res, next } = createMocks({ ip });
              limiter(req, res, next);

              const expectedRemaining = maxRequests - (i + 1);
              if (res.headers['X-RateLimit-Remaining'] !== expectedRemaining) return false;
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('X-RateLimit-Remaining is 0 when limit is exceeded (429 response)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.ipV4(),
          (maxRequests, ip) => {
            _clearStore();

            const limiter = rateLimiter({
              windowMs: 60000,
              maxRequests,
              keyGenerator: (req) => `prop22c:${req.ip}`,
            });

            // Exhaust the limit
            for (let i = 0; i < maxRequests; i++) {
              const { req, res, next } = createMocks({ ip });
              limiter(req, res, next);
            }

            // Next request should be 429 with Remaining = 0
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);

            if (res.statusCode !== 429) return false;
            if (res.headers['X-RateLimit-Remaining'] !== 0) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('headers are present on authLimiter responses (both success and 429)', () => {
      fc.assert(
        fc.property(fc.ipV4(), (ip) => {
          _clearStore();

          // Make 6 requests (5 should succeed, 6th should be 429)
          for (let i = 0; i < 6; i++) {
            const { req, res, next } = createMocks({ ip });
            authLimiter(req, res, next);

            // All headers must be present regardless of status
            if (res.headers['X-RateLimit-Limit'] === undefined) return false;
            if (res.headers['X-RateLimit-Remaining'] === undefined) return false;
            if (res.headers['X-RateLimit-Reset'] === undefined) return false;
            if (res.headers['X-RateLimit-Limit'] !== 5) return false;
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('headers are present on apiLimiter responses for both auth and unauth', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.ipV4(),
          (userId, ip) => {
            _clearStore();

            // Authenticated request
            const authMock = createMocks({ ip, user: { id: userId } });
            apiLimiter(authMock.req, authMock.res, authMock.next);
            if (authMock.res.headers['X-RateLimit-Limit'] === undefined) return false;
            if (authMock.res.headers['X-RateLimit-Remaining'] === undefined) return false;
            if (authMock.res.headers['X-RateLimit-Reset'] === undefined) return false;

            // Unauthenticated request
            const unauthMock = createMocks({ ip: '10.0.0.1', user: null });
            apiLimiter(unauthMock.req, unauthMock.res, unauthMock.next);
            if (unauthMock.res.headers['X-RateLimit-Limit'] === undefined) return false;
            if (unauthMock.res.headers['X-RateLimit-Remaining'] === undefined) return false;
            if (unauthMock.res.headers['X-RateLimit-Reset'] === undefined) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('X-RateLimit-Reset is a future Unix timestamp (seconds)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.ipV4(),
          (maxRequests, ip) => {
            _clearStore();

            const limiter = rateLimiter({
              windowMs: 60000,
              maxRequests,
              keyGenerator: (req) => `prop22f:${req.ip}`,
            });

            const nowSeconds = Math.floor(Date.now() / 1000);
            const { req, res, next } = createMocks({ ip });
            limiter(req, res, next);

            // Reset should be in the future (within ~60 seconds from now)
            const resetValue = res.headers['X-RateLimit-Reset'];
            if (resetValue < nowSeconds) return false;
            // Should not be more than 61 seconds in the future (window + small tolerance)
            if (resetValue > nowSeconds + 61) return false;

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
