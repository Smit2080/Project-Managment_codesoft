const express = require('express');
const request = require('supertest');
const { securityHeaders } = require('../../src/middleware/securityHeaders');

function createApp(env) {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = env;

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.get('/test', (req, res) => {
    res.json({ ok: true });
  });

  // Restore env after app creation
  process.env.NODE_ENV = originalEnv;
  return app;
}

describe('securityHeaders middleware', () => {
  describe('headers present in all environments', () => {
    let app;

    beforeAll(() => {
      app = createApp('development');
    });

    it('should set X-Content-Type-Options to nosniff', async () => {
      const res = await request(app).get('/test');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-Frame-Options to DENY', async () => {
      const res = await request(app).get('/test');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('should set X-XSS-Protection to 0', async () => {
      const res = await request(app).get('/test');
      expect(res.headers['x-xss-protection']).toBe('0');
    });

    it('should set Content-Security-Policy to default-src self', async () => {
      const res = await request(app).get('/test');
      expect(res.headers['content-security-policy']).toBe("default-src 'self'");
    });

    it('should NOT include X-Powered-By header', async () => {
      const res = await request(app).get('/test');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('HSTS header in production', () => {
    it('should set Strict-Transport-Security in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const app = express();
      app.disable('x-powered-by');
      app.use(securityHeaders());
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test');
      expect(res.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains'
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should NOT set Strict-Transport-Security in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const app = express();
      app.disable('x-powered-by');
      app.use(securityHeaders());
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test');
      expect(res.headers['strict-transport-security']).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });
});
