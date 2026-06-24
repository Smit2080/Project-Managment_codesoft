/**
 * Security Headers Middleware
 *
 * Sets security headers on every response:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - X-XSS-Protection: 0
 * - Strict-Transport-Security: max-age=31536000; includeSubDomains (production only)
 * - Content-Security-Policy: default-src 'self'
 * - Removes X-Powered-By header
 */

function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Content-Security-Policy', "default-src 'self'");

    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    }

    res.removeHeader('X-Powered-By');

    next();
  };
}

module.exports = { securityHeaders };
