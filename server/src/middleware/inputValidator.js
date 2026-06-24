const { ZodError } = require('zod');

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strips all HTML tags (including malformed/partial) from a string,
 * preserving the plain-text content between tags.
 * Handles: <tag>, </tag>, <tag attr="val">, < tag>, <\ttag>, malformed/partial tags.
 * The output will never contain '<' followed by a tag-like pattern.
 */
function sanitizeHtml(input) {
  if (typeof input !== 'string') return input;

  // Comprehensive regex that handles:
  // 1. Normal tags: <tag>, </tag>, <tag attr="val">
  // 2. Whitespace after <: < script>, <\tscript>, <\nscript>
  // 3. Whitespace before /: < /div>
  // 4. Self-closing: <br/>, <img />
  // 5. Partial/unclosed tags at end of string: <div, <script
  // The regex matches < followed by optional whitespace, optional /, optional whitespace,
  // then a letter, then any non-> chars, then optional >
  let result = input.replace(/<\s*\/?\s*[a-z][^>]*>?/gi, '');
  // Remove any trailing partial tag (< at end with no matching >)
  result = result.replace(/<[^>]*$/g, '');
  // Repeat to catch nested cases like <<b>text</b>> that leave behind <text>
  // Keep iterating until stable (max 5 passes to prevent infinite loops)
  let prev;
  let passes = 0;
  do {
    prev = result;
    result = result.replace(/<\s*\/?\s*[a-z][^>]*>?/gi, '');
    result = result.replace(/<[^>]*$/g, '');
    passes++;
  } while (result !== prev && passes < 5);

  return result;
}

/**
 * Recursively sanitize all string fields in an object or array.
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeHtml(obj);
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item));
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
}

/**
 * Middleware factory that validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (and sanitized) data.
 * On failure, returns 422 with field-level error details.
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      // Apply HTML sanitization to all string fields after validation
      req.body = sanitizeObject(parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(422).json({
          error: 'Validation Error',
          message: 'Invalid input data',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          statusCode: 422,
        });
      }
      next(err);
    }
  };
}

/**
 * Middleware factory that validates one or more URL path parameters
 * against UUID v4 format. Returns 400 Bad Request if any param is invalid.
 */
function validateUuidParam(...params) {
  return (req, res, next) => {
    for (const param of params) {
      const value = req.params[param];
      if (!value || !UUID_V4_REGEX.test(value)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid parameter format',
          statusCode: 400,
        });
      }
    }
    next();
  };
}

module.exports = { validate, sanitizeHtml, sanitizeObject, validateUuidParam };
