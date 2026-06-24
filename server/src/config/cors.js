/**
 * CORS Configuration
 *
 * Reads allowed origins from CORS_ORIGINS environment variable (comma-separated).
 * Defaults to 'http://localhost:5173' for development (Vite's default port).
 *
 * - Restricts methods to GET, POST, PUT, DELETE, OPTIONS
 * - Restricts allowed headers to Content-Type, Authorization, X-Requested-With
 * - Returns 204 for preflight from allowed origins
 * - Omits CORS headers for disallowed origins
 */

const getAllowedOrigins = () => {
  const originsEnv = process.env.CORS_ORIGINS;
  if (originsEnv) {
    return originsEnv.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
  return ['http://localhost:5173'];
};

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedOrigins();

    // Allow requests with no origin (e.g., same-origin, server-to-server, curl)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Return false to omit CORS headers for disallowed origins
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
};

module.exports = { corsOptions, getAllowedOrigins };
