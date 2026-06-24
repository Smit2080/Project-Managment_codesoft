const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAudit, sanitizeEntry } = require('../../src/services/auditLogger');

/**
 * Property 26: Audit log entries are well-formed
 *
 * For any auditable event (login, password change, project creation, archival, role change),
 * the Audit_Logger SHALL write a single-line JSON object containing timestamp (ISO 8601 UTC),
 * userId, ip, action, resourceType, resourceId, and outcome. The entry SHALL NOT contain
 * passwords, tokens, or request/response bodies.
 *
 * **Validates: Requirements 16.2, 16.3, 16.4**
 */
describe('Property 26: Audit log entries are well-formed', () => {
  let tempDir;
  let logPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    logPath = path.join(tempDir, 'audit.log');
    process.env.AUDIT_LOG_PATH = logPath;
  });

  afterEach(() => {
    delete process.env.AUDIT_LOG_PATH;
    try {
      if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  // Generators for valid audit entry fields
  const userIdArb = fc.oneof(fc.uuid(), fc.constant('anonymous'));
  const ipArb = fc.oneof(
    fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    fc.constant('::1')
  );
  const actionArb = fc.oneof(
    fc.constant('login_success'),
    fc.constant('login_failed'),
    fc.constant('password_change'),
    fc.constant('project_create'),
    fc.constant('project_archive'),
    fc.constant('role_change')
  );
  const resourceTypeArb = fc.oneof(
    fc.constant('user'),
    fc.constant('project'),
    fc.constant('member'),
    fc.constant('task')
  );
  const resourceIdArb = fc.uuid();
  const outcomeArb = fc.oneof(fc.constant('success'), fc.constant('failure'));

  // Generator for a valid audit entry
  const validEntryArb = fc.record({
    userId: userIdArb,
    ip: ipArb,
    action: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
    outcome: outcomeArb,
  });

  // ISO 8601 UTC pattern
  const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

  // Required fields in every audit entry
  const REQUIRED_FIELDS = ['timestamp', 'userId', 'ip', 'action', 'resourceType', 'resourceId', 'outcome'];

  // Sensitive field names that must never appear
  const SENSITIVE_PATTERNS = ['password', 'token', 'secret', 'authorization', 'cookie', 'session', 'body'];

  // Helper: wait for the async appendFile to flush
  function waitForWrite(filePath, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          resolve();
        } else if (Date.now() - start > timeout) {
          reject(new Error('Timed out waiting for audit log write'));
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });
  }

  it('logAudit writes a single-line JSON object with exactly 7 required fields', async () => {
    await fc.assert(
      fc.asyncProperty(validEntryArb, async (entry) => {
        // Remove existing log file to isolate this iteration
        if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

        logAudit(entry);

        // Wait for async write to complete
        await waitForWrite(logPath);

        const content = fs.readFileSync(logPath, 'utf-8').trim();

        // Should be exactly one line (single-line JSON)
        const lines = content.split('\n');
        expect(lines.length).toBe(1);

        // Should be valid JSON
        const parsed = JSON.parse(lines[0]);

        // Should contain exactly the 7 required fields
        const keys = Object.keys(parsed).sort();
        expect(keys).toEqual(REQUIRED_FIELDS.slice().sort());

        // Timestamp should be ISO 8601 UTC
        expect(parsed.timestamp).toMatch(ISO_8601_REGEX);

        // Other fields should match input
        expect(parsed.userId).toBe(entry.userId);
        expect(parsed.ip).toBe(entry.ip);
        expect(parsed.action).toBe(entry.action);
        expect(parsed.resourceType).toBe(entry.resourceType);
        expect(parsed.resourceId).toBe(entry.resourceId);
        expect(parsed.outcome).toBe(entry.outcome);
      }),
      { numRuns: 100 }
    );
  }, 30000);

  it('output never contains passwords, tokens, or request/response bodies regardless of input fields', async () => {
    // Generator that injects sensitive fields into the entry
    const sensitiveEntryArb = fc.record({
      userId: userIdArb,
      ip: ipArb,
      action: actionArb,
      resourceType: resourceTypeArb,
      resourceId: resourceIdArb,
      outcome: outcomeArb,
      // Extra sensitive fields that must be stripped
      password: fc.string({ minLength: 1, maxLength: 50 }),
      token: fc.string({ minLength: 1, maxLength: 100 }),
      secret: fc.string({ minLength: 1, maxLength: 50 }),
      authorization: fc.string({ minLength: 1, maxLength: 100 }),
      cookie: fc.string({ minLength: 1, maxLength: 100 }),
      session: fc.string({ minLength: 1, maxLength: 100 }),
      body: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ minLength: 1, maxLength: 50 })),
    });

    await fc.assert(
      fc.asyncProperty(sensitiveEntryArb, async (entry) => {
        if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

        logAudit(entry);

        await waitForWrite(logPath);

        const content = fs.readFileSync(logPath, 'utf-8').trim();
        const parsed = JSON.parse(content);

        // None of the sensitive fields should appear in the output
        for (const sensitiveKey of SENSITIVE_PATTERNS) {
          expect(parsed).not.toHaveProperty(sensitiveKey);
        }

        // Output should only have the 7 required fields
        const keys = Object.keys(parsed);
        expect(keys.length).toBe(7);
        for (const key of keys) {
          expect(REQUIRED_FIELDS).toContain(key);
        }
      }),
      { numRuns: 100 }
    );
  }, 30000);

  it('each entry is valid JSON on a single line', async () => {
    await fc.assert(
      fc.asyncProperty(validEntryArb, async (entry) => {
        if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

        logAudit(entry);

        await waitForWrite(logPath);

        const content = fs.readFileSync(logPath, 'utf-8');

        // The content should end with exactly one newline
        expect(content.endsWith('\n')).toBe(true);

        // The trimmed content should have no internal newlines (single line)
        const trimmed = content.trim();
        expect(trimmed.includes('\n')).toBe(false);

        // It should parse as valid JSON without error
        expect(() => JSON.parse(trimmed)).not.toThrow();
      }),
      { numRuns: 100 }
    );
  }, 30000);

  describe('sanitizeEntry strips sensitive fields', () => {
    it('returns only the 7 required fields regardless of extra input properties', () => {
      fc.assert(
        fc.property(
          fc.record({
            timestamp: fc.date().map((d) => d.toISOString()),
            userId: userIdArb,
            ip: ipArb,
            action: actionArb,
            resourceType: resourceTypeArb,
            resourceId: resourceIdArb,
            outcome: outcomeArb,
            // Random extra fields
            password: fc.string({ minLength: 1, maxLength: 50 }),
            token: fc.string({ minLength: 1, maxLength: 100 }),
            secret: fc.string({ minLength: 1, maxLength: 50 }),
            authorization: fc.string({ minLength: 1, maxLength: 100 }),
            cookie: fc.string({ minLength: 1, maxLength: 100 }),
            session: fc.string({ minLength: 1, maxLength: 100 }),
            body: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          (entry) => {
            const sanitized = sanitizeEntry(entry);
            const keys = Object.keys(sanitized).sort();
            expect(keys).toEqual(REQUIRED_FIELDS.slice().sort());

            // None of the sensitive patterns present
            for (const sensitiveKey of SENSITIVE_PATTERNS) {
              expect(sanitized).not.toHaveProperty(sensitiveKey);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
