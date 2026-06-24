require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const { corsOptions } = require('./config/cors');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { securityHeaders } = require('./middleware/securityHeaders');
const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// Disable X-Powered-By at the app level
app.disable('x-powered-by');

// --- Middleware Pipeline (order matters) ---

// 1. Rate limiters (before any body processing)
// Apply authLimiter to auth login/register/forgot-password specifically
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
// Apply apiLimiter to all other /api routes
app.use('/api', apiLimiter);

// 2. CORS (enforce origin whitelist)
app.use(cors(corsOptions));

// 3. Security headers
app.use(securityHeaders());

// 4. Body size limiter (express.json with 1MB limit)
app.use(express.json({ limit: '1mb' }));

// 5. Static file serving
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 6. Route registration (route-level middleware: auth → UUID validator → input validator → handler)
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Serve client static files
const clientDistPath = path.resolve(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDistPath));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  }
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
