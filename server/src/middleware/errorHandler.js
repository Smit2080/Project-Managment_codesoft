const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Logs full error details server-side with structured context.
 * Called before sending any response to the client.
 */
function logError(err, req) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack,
    },
    request: {
      method: req.method,
      path: req.originalUrl || req.url,
      params: req.params,
      ip: req.ip,
    },
  };

  console.error('[ErrorHandler]', JSON.stringify(logEntry));
}

/**
 * Centralized error handler middleware.
 * 
 * - Logs full error details server-side (stack, codes, request context)
 * - Maps Prisma errors to appropriate HTTP statuses without leaking internals
 * - Maps ZodError to 422 with field-level details
 * - Handles JWT errors (expired and invalid separately)
 * - Returns consistent { error, message, statusCode } JSON for all errors
 * - Suppresses stack traces, file paths, DB identifiers in production
 */
function errorHandler(err, req, res, _next) {
  // Log full error details server-side before responding
  logError(err, req);

  // ZodError → 422 with field-level details
  if (err.name === 'ZodError') {
    return res.status(422).json({
      error: 'Validation Error',
      message: 'Invalid input data',
      details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      statusCode: 422,
    });
  }

  // Prisma P2002 — unique constraint violation → 409
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this data already exists',
      statusCode: 409,
    });
  }

  // Prisma P2025 / P2016 — record not found → 404
  if (err.code === 'P2025' || err.code === 'P2016') {
    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource was not found',
      statusCode: 404,
    });
  }

  // TokenExpiredError — JWT token has expired → 401
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token has expired',
      statusCode: 401,
    });
  }

  // JsonWebTokenError — malformed or invalid JWT → 401
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  }

  // Entity too large (body parser) → 413
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body too large',
      statusCode: 413,
    });
  }

  // MulterError — file upload error → 400
  if (err.name === 'MulterError') {
    return res.status(400).json({
      error: 'Upload Error',
      message: err.message,
      statusCode: 400,
    });
  }

  // All other errors — use statusCode if set, otherwise 500
  const statusCode = err.statusCode || 500;

  if (statusCode === 500) {
    // In production: never expose internal details for 500 errors
    // In development: include error message for debugging
    return res.status(500).json({
      error: 'Internal Server Error',
      message: isProduction() ? 'Something went wrong' : (err.message || 'Something went wrong'),
      statusCode: 500,
    });
  }

  // Non-500 errors with explicit statusCode (e.g., 403, 401 from route handlers)
  res.status(statusCode).json({
    error: err.name || 'Error',
    message: err.message || 'An error occurred',
    statusCode,
  });
}

module.exports = { errorHandler };
