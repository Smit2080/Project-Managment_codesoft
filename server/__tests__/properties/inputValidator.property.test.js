const fc = require('fast-check');
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

describe('Input Validator - Property Tests', () => {
  /**
   * Property 23: HTML sanitization preserves text content
   *
   * For any input string containing HTML tags (including partial/malformed tags),
   * the sanitizer SHALL remove all tags while preserving the plain-text content
   * between them. The output SHALL never contain `<` followed by a tag-like pattern.
   *
   * **Validates: Requirements 12.3**
   */
  describe('Property 23: HTML sanitization preserves text content', () => {
    // Generator for strings containing HTML tags
    const tagNameArb = fc.stringMatching(/^[a-z]{1,10}$/);
    const textContentArb = fc.string({ minLength: 0, maxLength: 50 })
      .filter(s => !s.includes('<') && !s.includes('>'));

    // Generate simple HTML-wrapped text: <tag>text</tag>
    const simpleHtmlArb = fc.tuple(tagNameArb, textContentArb).map(
      ([tag, text]) => ({ input: `<${tag}>${text}</${tag}>`, text })
    );

    // Generate text with tags interspersed: text1<tag>text2</tag>text3
    const mixedHtmlArb = fc.tuple(textContentArb, tagNameArb, textContentArb, textContentArb).map(
      ([before, tag, inner, after]) => ({
        input: `${before}<${tag}>${inner}</${tag}>${after}`,
        text: `${before}${inner}${after}`,
      })
    );

    // Generate tags with attributes: <tag attr="val">text</tag>
    const attrHtmlArb = fc.tuple(
      tagNameArb,
      fc.stringMatching(/^[a-z]{1,8}$/),
      fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/),
      textContentArb
    ).map(([tag, attr, val, text]) => ({
      input: `<${tag} ${attr}="${val}">${text}</${tag}>`,
      text,
    }));

    // Generate self-closing tags: text<br/>text
    const selfClosingArb = fc.tuple(textContentArb, tagNameArb, textContentArb).map(
      ([before, tag, after]) => ({
        input: `${before}<${tag}/>${after}`,
        text: `${before}${after}`,
      })
    );

    // Generate partial/unclosed tags at end: text<tag
    const partialTagArb = fc.tuple(textContentArb, tagNameArb).map(
      ([text, tag]) => ({
        input: `${text}<${tag}`,
        text,
      })
    );

    it('strips simple HTML tags while preserving inner text content', () => {
      fc.assert(
        fc.property(simpleHtmlArb, ({ input, text }) => {
          const result = sanitizeHtml(input);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves text content around and between tags', () => {
      fc.assert(
        fc.property(mixedHtmlArb, ({ input, text }) => {
          const result = sanitizeHtml(input);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    it('strips tags with attributes while preserving inner text', () => {
      fc.assert(
        fc.property(attrHtmlArb, ({ input, text }) => {
          const result = sanitizeHtml(input);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    it('strips self-closing tags while preserving surrounding text', () => {
      fc.assert(
        fc.property(selfClosingArb, ({ input, text }) => {
          const result = sanitizeHtml(input);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    it('strips partial/unclosed tags at end of string', () => {
      fc.assert(
        fc.property(partialTagArb, ({ input, text }) => {
          const result = sanitizeHtml(input);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    it('output never contains < followed by a tag-like pattern', () => {
      // Generate arbitrary strings that may contain HTML-like content
      const arbitraryWithTagsArb = fc.oneof(
        simpleHtmlArb.map(x => x.input),
        mixedHtmlArb.map(x => x.input),
        attrHtmlArb.map(x => x.input),
        selfClosingArb.map(x => x.input),
        partialTagArb.map(x => x.input),
        // Random strings with < and > characters
        fc.string({ minLength: 1, maxLength: 100 })
      );

      fc.assert(
        fc.property(arbitraryWithTagsArb, (input) => {
          const result = sanitizeHtml(input);
          // Output should never contain < followed by optional whitespace then a letter (tag pattern)
          const tagLikePattern = /<\s*\/?\s*[a-z]/i;
          expect(tagLikePattern.test(result)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('plain text without any < characters passes through unchanged', () => {
      const plainTextArb = fc.string({ minLength: 0, maxLength: 200 })
        .filter(s => !s.includes('<'));

      fc.assert(
        fc.property(plainTextArb, (text) => {
          const result = sanitizeHtml(text);
          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 24: Invalid UUID params rejected before database query
   *
   * For any non-UUID-v4 string passed as a path parameter, validateUuidParam
   * SHALL reject the request with 400 before any database query is executed.
   *
   * **Validates: Requirements 12.4**
   */
  describe('Property 24: Invalid UUID params rejected before database query', () => {
    // Valid UUID v4 generator
    const validUuidArb = fc.uuid().filter(uuid => {
      // Ensure it matches UUID v4 format (version 4 and variant 8/9/a/b)
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
    });

    // Invalid UUID generators - various types of non-UUID strings
    const nonUuidArb = fc.oneof(
      // Random strings
      fc.string({ minLength: 1, maxLength: 100 }).filter(s =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
      ),
      // Numeric strings
      fc.nat().map(n => String(n)),
      // UUID-like but wrong version (not 4)
      fc.tuple(
        fc.hexaString({ minLength: 8, maxLength: 8 }),
        fc.hexaString({ minLength: 4, maxLength: 4 }),
        fc.constantFrom('1', '2', '3', '5'),
        fc.hexaString({ minLength: 3, maxLength: 3 }),
        fc.hexaString({ minLength: 4, maxLength: 4 }),
        fc.hexaString({ minLength: 12, maxLength: 12 })
      ).map(([a, b, ver, c, d, e]) => `${a}-${b}-${ver}${c}-${d}-${e}`),
      // UUID-like but wrong variant bits
      fc.tuple(
        fc.hexaString({ minLength: 8, maxLength: 8 }),
        fc.hexaString({ minLength: 4, maxLength: 4 }),
        fc.hexaString({ minLength: 3, maxLength: 3 }),
        fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', 'c', 'd', 'e', 'f'),
        fc.hexaString({ minLength: 3, maxLength: 3 }),
        fc.hexaString({ minLength: 12, maxLength: 12 })
      ).map(([a, b, c, variant, d, e]) => `${a}-${b}-4${c}-${variant}${d}-${e}`),
      // Empty string
      fc.constant(''),
      // Strings with special characters
      fc.stringMatching(/^[a-zA-Z0-9!@#$%^&*()]{1,50}$/)
    );

    it('rejects any non-UUID-v4 string with 400 and does not call next()', () => {
      fc.assert(
        fc.property(nonUuidArb, (invalidId) => {
          const { req, res, next } = createMocks({}, { id: invalidId });

          validateUuidParam('id')(req, res, next);

          expect(res.statusCode).toBe(400);
          expect(res.body.error).toBe('Bad Request');
          expect(res.body.message).toBe('Invalid parameter format');
          expect(res.body.statusCode).toBe(400);
          // next() should NOT be called - no database query can execute
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('accepts valid UUID v4 strings and calls next()', () => {
      fc.assert(
        fc.property(validUuidArb, (validId) => {
          const { req, res, next } = createMocks({}, { id: validId });

          validateUuidParam('id')(req, res, next);

          expect(res.statusCode).toBeNull();
          expect(next).toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects when any one of multiple params is invalid', () => {
      fc.assert(
        fc.property(validUuidArb, nonUuidArb, (validId, invalidId) => {
          const { req, res, next } = createMocks({}, {
            projectId: validId,
            taskId: invalidId,
          });

          validateUuidParam('projectId', 'taskId')(req, res, next);

          expect(res.statusCode).toBe(400);
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects missing params with 400', () => {
      const paramNameArb = fc.stringMatching(/^[a-z]{1,10}$/);

      fc.assert(
        fc.property(paramNameArb, (paramName) => {
          const { req, res, next } = createMocks({}, {});

          validateUuidParam(paramName)(req, res, next);

          expect(res.statusCode).toBe(400);
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 7: Invalid project/task input rejected with field errors
   *
   * For any project or task creation/update payload with at least one field
   * violating Zod schema constraints, the validate middleware SHALL return 422
   * with field-level error details.
   *
   * **Validates: Requirements 3.2, 5.2**
   */
  describe('Property 7: Invalid project/task input rejected with field errors', () => {
    // Project schemas (matching the route definitions)
    const projectCreateSchema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
    });

    const taskCreateSchema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      assigneeId: z.string().uuid().nullable().optional(),
      dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    });

    // --- Invalid project payloads ---

    // Name empty
    const emptyNameProjectArb = fc.record({
      name: fc.constant(''),
      description: fc.string({ maxLength: 500 }).filter(s => s.length <= 500),
    });

    // Name too long (>100 chars)
    const longNameProjectArb = fc.record({
      name: fc.string({ minLength: 101, maxLength: 200 }),
      description: fc.string({ maxLength: 500 }).filter(s => s.length <= 500),
    });

    // Description too long (>500 chars)
    const longDescProjectArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      description: fc.string({ minLength: 501, maxLength: 700 }),
    });

    // --- Invalid task payloads ---

    // Title empty
    const emptyTitleTaskArb = fc.record({
      title: fc.constant(''),
    });

    // Title too long (>200 chars)
    const longTitleTaskArb = fc.record({
      title: fc.string({ minLength: 201, maxLength: 300 }),
    });

    // Description too long (>2000 chars)
    const longDescTaskArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
      description: fc.string({ minLength: 2001, maxLength: 2200 }),
    });

    // Invalid status
    const invalidStatusTaskArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
      status: fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => !['todo', 'in_progress', 'in_review', 'done'].includes(s)),
    });

    // Invalid priority
    const invalidPriorityTaskArb = fc.record({
      title: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
      priority: fc.string({ minLength: 1, maxLength: 20 })
        .filter(s => !['low', 'medium', 'high', 'urgent'].includes(s)),
    });

    it('rejects project creation with empty name (returns 422 with field errors)', () => {
      fc.assert(
        fc.property(emptyNameProjectArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(projectCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          expect(res.body.details.length).toBeGreaterThan(0);
          // Should have a detail about the 'name' field
          const nameError = res.body.details.find(d => d.field === 'name');
          expect(nameError).toBeDefined();
          expect(nameError.message).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects project creation with name exceeding 100 characters', () => {
      fc.assert(
        fc.property(longNameProjectArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(projectCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const nameError = res.body.details.find(d => d.field === 'name');
          expect(nameError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects project creation with description exceeding 500 characters', () => {
      fc.assert(
        fc.property(longDescProjectArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(projectCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const descError = res.body.details.find(d => d.field === 'description');
          expect(descError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
);
    });

    it('rejects task creation with empty title', () => {
      fc.assert(
        fc.property(emptyTitleTaskArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(taskCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const titleError = res.body.details.find(d => d.field === 'title');
          expect(titleError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects task creation with title exceeding 200 characters', () => {
      fc.assert(
        fc.property(longTitleTaskArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(taskCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const titleError = res.body.details.find(d => d.field === 'title');
          expect(titleError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects task creation with description exceeding 2000 characters', () => {
      fc.assert(
        fc.property(longDescTaskArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(taskCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const descError = res.body.details.find(d => d.field === 'description');
          expect(descError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects task creation with unrecognized status value', () => {
      fc.assert(
        fc.property(invalidStatusTaskArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(taskCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const statusError = res.body.details.find(d => d.field === 'status');
          expect(statusError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('rejects task creation with unrecognized priority value', () => {
      fc.assert(
        fc.property(invalidPriorityTaskArb, (payload) => {
          const { req, res, next } = createMocks(payload);

          validate(taskCreateSchema)(req, res, next);

          expect(res.statusCode).toBe(422);
          expect(res.body.error).toBe('Validation Error');
          expect(Array.isArray(res.body.details)).toBe(true);
          const priorityError = res.body.details.find(d => d.field === 'priority');
          expect(priorityError).toBeDefined();
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });

    it('all validation errors include statusCode 422 and consistent structure', () => {
      const allInvalidPayloads = fc.oneof(
        emptyNameProjectArb.map(p => ({ payload: p, schema: projectCreateSchema })),
        longNameProjectArb.map(p => ({ payload: p, schema: projectCreateSchema })),
        longDescProjectArb.map(p => ({ payload: p, schema: projectCreateSchema })),
        emptyTitleTaskArb.map(p => ({ payload: p, schema: taskCreateSchema })),
        longTitleTaskArb.map(p => ({ payload: p, schema: taskCreateSchema })),
        longDescTaskArb.map(p => ({ payload: p, schema: taskCreateSchema })),
        invalidStatusTaskArb.map(p => ({ payload: p, schema: taskCreateSchema })),
        invalidPriorityTaskArb.map(p => ({ payload: p, schema: taskCreateSchema }))
      );

      fc.assert(
        fc.property(allInvalidPayloads, ({ payload, schema }) => {
          const { req, res, next } = createMocks(payload);

          validate(schema)(req, res, next);

          // Consistent error response structure
          expect(res.statusCode).toBe(422);
          expect(res.body).toHaveProperty('error', 'Validation Error');
          expect(res.body).toHaveProperty('message', 'Invalid input data');
          expect(res.body).toHaveProperty('statusCode', 422);
          expect(res.body).toHaveProperty('details');
          expect(Array.isArray(res.body.details)).toBe(true);
          expect(res.body.details.length).toBeGreaterThan(0);
          // Each detail should have field and message
          for (const detail of res.body.details) {
            expect(detail).toHaveProperty('field');
            expect(detail).toHaveProperty('message');
            expect(typeof detail.field).toBe('string');
            expect(typeof detail.message).toBe('string');
          }
          // next() should never be called for invalid input
          expect(next).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });
});
