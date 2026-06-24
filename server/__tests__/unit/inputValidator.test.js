const { z } = require('zod');
const {
  validate,
  sanitizeHtml,
  sanitizeObject,
  validateUuidParam,
} = require('../../src/middleware/inputValidator');

// Helper to create mock req/res/next
function createMocks(body = {}, params = {}) {
  const req = { body, params };
  const res = {
    statusCode: null,
    body: null,
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

describe('inputValidator middleware', () => {
  describe('sanitizeHtml', () => {
    it('should remove simple HTML tags', () => {
      expect(sanitizeHtml('<b>bold</b>')).toBe('bold');
    });

    it('should remove self-closing tags', () => {
      expect(sanitizeHtml('hello<br/>world')).toBe('helloworld');
    });

    it('should remove tags with attributes', () => {
      expect(sanitizeHtml('<a href="http://evil.com">click</a>')).toBe('click');
    });

    it('should handle malformed/partial tags', () => {
      expect(sanitizeHtml('hello<script')).toBe('hello');
    });

    it('should remove nested tags', () => {
      expect(sanitizeHtml('<div><p>text</p></div>')).toBe('text');
    });

    it('should preserve plain text without tags', () => {
      expect(sanitizeHtml('just plain text')).toBe('just plain text');
    });

    it('should handle empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('should return non-string inputs unchanged', () => {
      expect(sanitizeHtml(123)).toBe(123);
      expect(sanitizeHtml(null)).toBe(null);
      expect(sanitizeHtml(undefined)).toBe(undefined);
    });

    it('should remove script tags and content markers', () => {
      expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    it('should handle tags with multiple attributes', () => {
      expect(sanitizeHtml('<div class="foo" id="bar">content</div>')).toBe('content');
    });

    it('should handle unclosed tags at end of string', () => {
      expect(sanitizeHtml('text<div')).toBe('text');
    });

    it('should remove tags with whitespace after <', () => {
      expect(sanitizeHtml('< script>alert(1)</script>')).toBe('alert(1)');
    });

    it('should remove tags with tab/newline after <', () => {
      expect(sanitizeHtml('<\tscript>bad</script>')).toBe('bad');
      expect(sanitizeHtml('<\nscript>bad</script>')).toBe('bad');
    });

    it('should remove closing tags with whitespace before /', () => {
      expect(sanitizeHtml('text< /div>')).toBe('text');
    });

    it('should handle double-nested angle brackets', () => {
      expect(sanitizeHtml('<<b>nested</b>>')).not.toContain('<b>');
    });

    it('should preserve lone < when not followed by a letter', () => {
      expect(sanitizeHtml('<>')).toBe('<>');
      expect(sanitizeHtml('<123>test')).toBe('<123>test');
    });
  });

  describe('sanitizeObject', () => {
    it('should sanitize string values in an object', () => {
      const input = { name: '<b>test</b>', count: 5 };
      const result = sanitizeObject(input);
      expect(result).toEqual({ name: 'test', count: 5 });
    });

    it('should sanitize nested objects', () => {
      const input = { outer: { inner: '<script>x</script>' } };
      const result = sanitizeObject(input);
      expect(result).toEqual({ outer: { inner: 'x' } });
    });

    it('should sanitize arrays', () => {
      const input = { items: ['<b>a</b>', '<i>b</i>'] };
      const result = sanitizeObject(input);
      expect(result).toEqual({ items: ['a', 'b'] });
    });

    it('should handle null and undefined', () => {
      expect(sanitizeObject(null)).toBeNull();
      expect(sanitizeObject(undefined)).toBeUndefined();
    });

    it('should preserve non-string primitives', () => {
      const input = { bool: true, num: 42, str: 'clean' };
      const result = sanitizeObject(input);
      expect(result).toEqual({ bool: true, num: 42, str: 'clean' });
    });
  });

  describe('validate(schema)', () => {
    const testSchema = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
    });

    it('should call next() when body is valid', () => {
      const { req, res, next } = createMocks({
        name: 'Test User',
        email: 'test@example.com',
      });

      validate(testSchema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it('should replace req.body with parsed and sanitized data', () => {
      const { req, res, next } = createMocks({
        name: '<b>Test</b> User',
        email: 'test@example.com',
      });

      validate(testSchema)(req, res, next);

      expect(req.body.name).toBe('Test User');
      expect(req.body.email).toBe('test@example.com');
    });

    it('should strip unknown fields from body', () => {
      const { req, res, next } = createMocks({
        name: 'Test',
        email: 'a@b.com',
        extra: 'should be removed',
      });

      validate(testSchema)(req, res, next);

      expect(req.body.extra).toBeUndefined();
    });

    it('should return 422 with field-level details on validation failure', () => {
      const { req, res, next } = createMocks({
        name: '',
        email: 'not-an-email',
      });

      validate(testSchema)(req, res, next);

      expect(res.statusCode).toBe(422);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toBe('Invalid input data');
      expect(res.body.statusCode).toBe(422);
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(res.body.details[0]).toHaveProperty('field');
      expect(res.body.details[0]).toHaveProperty('message');
    });

    it('should not call next() on validation failure', () => {
      const { req, res, next } = createMocks({});

      validate(testSchema)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(422);
    });

    it('should identify specific invalid fields', () => {
      const { req, res, next } = createMocks({
        name: 'Valid Name',
        email: 'bad-email',
      });

      validate(testSchema)(req, res, next);

      expect(res.statusCode).toBe(422);
      const emailError = res.body.details.find(d => d.field === 'email');
      expect(emailError).toBeDefined();
      expect(emailError.message).toBeDefined();
    });
  });

  describe('validateUuidParam', () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';
    const validUuidVariant = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    it('should call next() for valid UUID v4 params', () => {
      const { req, res, next } = createMocks({}, { id: validUuid });

      validateUuidParam('id')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it('should accept another valid UUID v4', () => {
      const { req, res, next } = createMocks({}, { id: validUuidVariant });

      validateUuidParam('id')(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 400 for non-UUID string', () => {
      const { req, res, next } = createMocks({}, { id: 'not-a-uuid' });

      validateUuidParam('id')(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toBe('Invalid parameter format');
      expect(res.body.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 for UUID v1 (not v4)', () => {
      const uuidV1 = '550e8400-e29b-11d4-a716-446655440000'; // version 1
      const { req, res, next } = createMocks({}, { id: uuidV1 });

      validateUuidParam('id')(req, res, next);

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for missing param', () => {
      const { req, res, next } = createMocks({}, {});

      validateUuidParam('id')(req, res, next);

      expect(res.statusCode).toBe(400);
    });

    it('should validate multiple params', () => {
      const { req, res, next } = createMocks({}, {
        projectId: validUuid,
        taskId: validUuidVariant,
      });

      validateUuidParam('projectId', 'taskId')(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should fail if any param is invalid', () => {
      const { req, res, next } = createMocks({}, {
        projectId: validUuid,
        taskId: 'invalid',
      });

      validateUuidParam('projectId', 'taskId')(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 for empty string param', () => {
      const { req, res, next } = createMocks({}, { id: '' });

      validateUuidParam('id')(req, res, next);

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for UUID with wrong variant bits', () => {
      // variant bits should be 8, 9, a, or b in position 19
      const wrongVariant = '550e8400-e29b-41d4-c716-446655440000'; // c is wrong
      const { req, res, next } = createMocks({}, { id: wrongVariant });

      validateUuidParam('id')(req, res, next);

      expect(res.statusCode).toBe(400);
    });
  });
});
