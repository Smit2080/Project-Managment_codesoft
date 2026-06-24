/**
 * Rate Limiter Middleware - Sliding Window Algorithm
 *
 * Uses an in-memory Map to store request timestamps per key.
 * Timestamps expire exactly 60 seconds after they were made (continuously decaying window).
 *
 * Two pre-configured instances:
 * - authLimiter: 5 req/min per IP (for login/register)
 * - combinedApiLimiter: 100 req/min per authenticated user, 20 req/min per IP for unauthenticated
 */

// In-memory store: Map<string, number[]> where values are arrays of request timestamps
const requestStore = new Map();

/**
 * Get the store (for testing purposes).
 * @returns {Map} The request store
 */
function _getStore() {
  return requestStore;
}

/**
 * Clear the store (for testing purposes).
 */
function _clearStore() {
  requestStore.clear();
}

/**
 * Remove expired timestamps from the store for a given key.
 * A timestamp is expired if it is older than windowMs from now.
 * @param {string} key - The rate limit key
 * @param {number} now - Current time in milliseconds
 * @param {number} windowMs - Window duration in milliseconds
 * @returns {number[]} - Array of valid (non-expired) timestamps
 */
function cleanupExpired(key, now, windowMs) {
  const timestamps = requestStore.get(key);
  if (!timestamps || timestamps.length === 0) {
    requestStore.delete(key);
    return [];
  }

  const cutoff = now - windowMs;
  // Filter to only timestamps within the window
  const valid = timestamps.filter((ts) => ts > cutoff);

  if (valid.length === 0) {
    requestStore.delete(key);
  } else {
    requestStore.set(key, valid);
  }

  return valid;
}

/**
 * Creates a rate limiter middleware with the given configuration.
 * @param {object} config
 * @param {number} config.windowMs - Window duration in milliseconds (default: 60000)
 * @param {number} config.maxRequests - Maximum requests allowed in the window
 * @param {function} config.keyGenerator - Function that returns the rate limit key from a request
 * @returns {function} Express middleware
 */
function rateLimiter({ windowMs = 60000, maxRequests, keyGenerator }) {
  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // Lazy cleanup: remove expired timestamps for this key
    const validTimestamps = cleanupExpired(key, now, windowMs);

    if (validTimestamps.length >= maxRequests) {
      // Rate limit exceeded
      // Find the earliest timestamp in the window to calculate Retry-After
      const oldestTimestamp = validTimestamps[0];
      const retryAfterMs = oldestTimestamp + windowMs - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + retryAfterMs) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);

      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Too many requests',
        statusCode: 429,
      });
    }

    // Record this request timestamp
    validTimestamps.push(now);
    requestStore.set(key, validTimestamps);

    // Set rate limit headers on successful requests
    const remaining = maxRequests - validTimestamps.length;
    // Reset time is when the oldest request in the window will expire
    const resetTime = validTimestamps.length > 0
      ? Math.ceil((validTimestamps[0] + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    next();
  };
}

/**
 * Get client IP from request, supporting proxies.
 * @param {object} req - Express request
 * @returns {string} IP address
 */
function getClientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
}

/**
 * Auth rate limiter: 5 requests per minute per IP address.
 * Applied to login and register endpoints.
 */
const authLimiter = rateLimiter({
  windowMs: 60000,
  maxRequests: 5,
  keyGenerator: (req) => `auth:${getClientIp(req)}`,
});

/**
 * Combined API rate limiter: 100 requests per minute per authenticated user,
 * 20 requests per minute per IP for unauthenticated requests.
 *
 * Identifies authenticated users by req.user.userId (set by auth middleware).
 * Falls back to IP-based limiting for unauthenticated requests.
 */
function combinedApiLimiter(req, res, next) {
  const userId = req.user && (req.user.userId || req.user.id);
  if (userId) {
    // Authenticated user: 100 req/min per userId
    const key = `api:user:${userId}`;
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;

    // Lazy cleanup
    const validTimestamps = cleanupExpired(key, now, windowMs);

    if (validTimestamps.length >= maxRequests) {
      const oldestTimestamp = validTimestamps[0];
      const retryAfterMs = oldestTimestamp + windowMs - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + retryAfterMs) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);

      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Too many requests',
        statusCode: 429,
      });
    }

    validTimestamps.push(now);
    requestStore.set(key, validTimestamps);

    const remaining = maxRequests - validTimestamps.length;
    const resetTime = validTimestamps.length > 0
      ? Math.ceil((validTimestamps[0] + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    return next();
  }

  // Unauthenticated: 20 req/min per IP
  const key = `api:ip:${getClientIp(req)}`;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 20;

  // Lazy cleanup
  const validTimestamps = cleanupExpired(key, now, windowMs);

  if (validTimestamps.length >= maxRequests) {
    const oldestTimestamp = validTimestamps[0];
    const retryAfterMs = oldestTimestamp + windowMs - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + retryAfterMs) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds);

    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many requests',
      statusCode: 429,
    });
  }

  validTimestamps.push(now);
  requestStore.set(key, validTimestamps);

  const remaining = maxRequests - validTimestamps.length;
  const resetTime = validTimestamps.length > 0
    ? Math.ceil((validTimestamps[0] + windowMs) / 1000)
    : Math.ceil((now + windowMs) / 1000);

  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetTime);

  next();
}

// Also export as apiLimiter for backward compatibility with server/src/index.js
const apiLimiter = combinedApiLimiter;

module.exports = {
  rateLimiter,
  authLimiter,
  apiLimiter,
  combinedApiLimiter,
  getClientIp,
  _getStore,
  _clearStore,
};
