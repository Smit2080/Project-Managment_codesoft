const jwt = require('jsonwebtoken');

describe('auth config - JWT startup validation', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;
  const originalExpires = process.env.JWT_EXPIRES_IN;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    if (originalExpires !== undefined) {
      process.env.JWT_EXPIRES_IN = originalExpires;
    } else {
      delete process.env.JWT_EXPIRES_IN;
    }
    // Clear module cache to allow re-import with different env
    jest.resetModules();
  });

  describe('production startup validation', () => {
    it('should exit with code 1 when JWT_SECRET is not set in production', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => require('../../src/config/auth')).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('should exit with code 1 when JWT_SECRET is shorter than 32 characters in production', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'short-secret-only-20ch!';

      expect(() => require('../../src/config/auth')).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('should start successfully when JWT_SECRET is exactly 32 characters in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a'.repeat(32);

      const auth = require('../../src/config/auth');
      expect(auth.generateToken).toBeDefined();
      expect(auth.verifyToken).toBeDefined();
    });

    it('should start successfully when JWT_SECRET is longer than 32 characters in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a'.repeat(64);

      const auth = require('../../src/config/auth');
      expect(auth.generateToken).toBeDefined();
    });
  });

  describe('non-production environments', () => {
    it('should start without JWT_SECRET in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      const auth = require('../../src/config/auth');
      expect(auth.generateToken).toBeDefined();
    });

    it('should start with a short JWT_SECRET in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'short';

      const auth = require('../../src/config/auth');
      expect(auth.generateToken).toBeDefined();
    });
  });

  describe('JWT_EXPIRES_IN configuration', () => {
    it('should default to 7d when JWT_EXPIRES_IN is not set', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_EXPIRES_IN;

      const auth = require('../../src/config/auth');
      expect(auth.JWT_EXPIRES_IN).toBe('7d');
    });

    it('should use JWT_EXPIRES_IN from environment variable', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_EXPIRES_IN = '1h';

      const auth = require('../../src/config/auth');
      expect(auth.JWT_EXPIRES_IN).toBe('1h');
    });
  });

  describe('token payload minimality', () => {
    it('should generate token with only userId and exp (no PII)', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'test-secret-for-unit-tests-32chars!';

      const auth = require('../../src/config/auth');
      const token = auth.generateToken('user-123');
      const decoded = jwt.decode(token);

      // Should contain userId and timing fields only
      expect(decoded.userId).toBe('user-123');
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();

      // Should NOT contain PII
      expect(decoded.email).toBeUndefined();
      expect(decoded.name).toBeUndefined();
      expect(decoded.displayName).toBeUndefined();
      expect(decoded.password).toBeUndefined();
    });

    it('should produce a verifiable token', () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'test-secret-for-unit-tests-32chars!';

      const auth = require('../../src/config/auth');
      const token = auth.generateToken('user-456');
      const verified = auth.verifyToken(token);

      expect(verified.userId).toBe('user-456');
      expect(verified.exp).toBeDefined();
    });
  });
});
