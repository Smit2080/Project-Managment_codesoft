const fs = require('fs');
const path = require('path');
const { logAudit, sanitizeEntry, getLogPath, ensureLogDirectory } = require('../../src/services/auditLogger');

// Mock fs module
jest.mock('fs');

describe('auditLogger service', () => {
  let stderrSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    delete process.env.AUDIT_LOG_PATH;
    fs.existsSync.mockReturnValue(true);
    fs.appendFile.mockImplementation((filePath, data, cb) => cb(null));
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('sanitizeEntry', () => {
    it('should return only allowed audit fields', () => {
      const entry = {
        userId: 'user-123',
        ip: '192.168.1.1',
        action: 'login_success',
        resourceType: 'user',
        resourceId: 'user-123',
        outcome: 'success',
        password: 'secret123',
        token: 'jwt-token',
        body: { sensitive: 'data' },
        extraField: 'should be excluded',
      };

      const result = sanitizeEntry(entry);

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('userId', 'user-123');
      expect(result).toHaveProperty('ip', '192.168.1.1');
      expect(result).toHaveProperty('action', 'login_success');
      expect(result).toHaveProperty('resourceType', 'user');
      expect(result).toHaveProperty('resourceId', 'user-123');
      expect(result).toHaveProperty('outcome', 'success');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('body');
      expect(result).not.toHaveProperty('extraField');
    });

    it('should only include the 7 allowed fields', () => {
      const entry = {
        userId: 'u1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'project',
        resourceId: 'p1',
        outcome: 'success',
      };

      const result = sanitizeEntry(entry);
      const keys = Object.keys(result);

      expect(keys).toEqual(['timestamp', 'userId', 'ip', 'action', 'resourceType', 'resourceId', 'outcome']);
    });
  });

  describe('getLogPath', () => {
    it('should return default path when env var not set', () => {
      delete process.env.AUDIT_LOG_PATH;
      expect(getLogPath()).toBe('./logs/audit.log');
    });

    it('should return path from AUDIT_LOG_PATH env var', () => {
      process.env.AUDIT_LOG_PATH = '/var/log/audit.log';
      expect(getLogPath()).toBe('/var/log/audit.log');
    });
  });

  describe('ensureLogDirectory', () => {
    it('should create directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {});

      ensureLogDirectory('/some/path/audit.log');

      expect(fs.mkdirSync).toHaveBeenCalledWith('/some/path', { recursive: true });
    });

    it('should not create directory if it already exists', () => {
      fs.existsSync.mockReturnValue(true);

      ensureLogDirectory('/some/path/audit.log');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('logAudit', () => {
    it('should write a single-line JSON object to the log file', () => {
      const entry = {
        userId: 'user-456',
        ip: '10.0.0.1',
        action: 'login_success',
        resourceType: 'user',
        resourceId: 'user-456',
        outcome: 'success',
      };

      logAudit(entry);

      expect(fs.appendFile).toHaveBeenCalledTimes(1);
      const [filePath, data] = fs.appendFile.mock.calls[0];
      expect(filePath).toBe('./logs/audit.log');

      // Verify it's a single-line JSON ending with newline
      expect(data.endsWith('\n')).toBe(true);
      const lines = data.trim().split('\n');
      expect(lines).toHaveLength(1);

      // Verify it's valid JSON with the expected fields
      const parsed = JSON.parse(lines[0]);
      expect(parsed.userId).toBe('user-456');
      expect(parsed.ip).toBe('10.0.0.1');
      expect(parsed.action).toBe('login_success');
      expect(parsed.resourceType).toBe('user');
      expect(parsed.resourceId).toBe('user-456');
      expect(parsed.outcome).toBe('success');
    });

    it('should include an ISO 8601 UTC timestamp', () => {
      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test_action',
        resourceType: 'test',
        resourceId: 'test-1',
        outcome: 'success',
      };

      logAudit(entry);

      const [, data] = fs.appendFile.mock.calls[0];
      const parsed = JSON.parse(data.trim());

      // ISO 8601 UTC format: ends with Z
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('should never include passwords, tokens, or body fields', () => {
      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'password_change',
        resourceType: 'user',
        resourceId: 'user-1',
        outcome: 'success',
        password: 'my-secret-password',
        token: 'jwt-secret-token',
        authorization: 'Bearer xyz',
        body: { request: 'data' },
      };

      logAudit(entry);

      const [, data] = fs.appendFile.mock.calls[0];
      const logContent = data.trim();

      expect(logContent).not.toContain('my-secret-password');
      expect(logContent).not.toContain('jwt-secret-token');
      expect(logContent).not.toContain('Bearer xyz');
      expect(logContent).not.toContain('"body"');
    });

    it('should use AUDIT_LOG_PATH env var when set', () => {
      process.env.AUDIT_LOG_PATH = '/custom/path/audit.log';

      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'test',
        resourceId: 't1',
        outcome: 'success',
      };

      logAudit(entry);

      const [filePath] = fs.appendFile.mock.calls[0];
      expect(filePath).toBe('/custom/path/audit.log');
    });

    it('should not throw or block when appendFile fails', () => {
      fs.appendFile.mockImplementation((filePath, data, cb) => {
        cb(new Error('Disk full'));
      });

      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'test',
        resourceId: 't1',
        outcome: 'success',
      };

      // Should not throw
      expect(() => logAudit(entry)).not.toThrow();
    });

    it('should log to stderr when write fails', () => {
      fs.appendFile.mockImplementation((filePath, data, cb) => {
        cb(new Error('Permission denied'));
      });

      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'test',
        resourceId: 't1',
        outcome: 'failure',
      };

      logAudit(entry);

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('AUDIT_LOG_ERROR')
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied')
      );
    });

    it('should log to stderr when synchronous error occurs (e.g., directory creation fails)', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Cannot create directory');
      });

      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'test',
        resourceId: 't1',
        outcome: 'failure',
      };

      // Should not throw
      expect(() => logAudit(entry)).not.toThrow();

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot create directory')
      );
    });

    it('should never block the calling operation', () => {
      // logAudit uses appendFile (async) — verify it returns immediately
      const start = Date.now();

      const entry = {
        userId: 'user-1',
        ip: '127.0.0.1',
        action: 'test',
        resourceType: 'test',
        resourceId: 't1',
        outcome: 'success',
      };

      logAudit(entry);

      const elapsed = Date.now() - start;
      // Should complete in < 50ms (fire-and-forget)
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle "anonymous" as userId for unauthenticated requests', () => {
      const entry = {
        userId: 'anonymous',
        ip: '192.168.0.1',
        action: 'login_failed',
        resourceType: 'user',
        resourceId: 'unknown',
        outcome: 'failure',
      };

      logAudit(entry);

      const [, data] = fs.appendFile.mock.calls[0];
      const parsed = JSON.parse(data.trim());
      expect(parsed.userId).toBe('anonymous');
    });
  });
});
