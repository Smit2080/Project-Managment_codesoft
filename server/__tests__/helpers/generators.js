/**
 * Fast-check Generators
 *
 * Shared arbitraries for property-based tests. These generators produce
 * valid and invalid payloads for registration, projects, and tasks.
 */

const fc = require('fast-check');

// ==========================================
// UUID Generators
// ==========================================

/** UUID v4 that passes strict v4 validation (version nibble = 4, variant bits = 10xx) */
const uuidV4Arb = fc.uuid().filter(
  u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)
);

/** Any valid UUID (v1-v5) */
const uuidArb = fc.uuid();

// ==========================================
// Registration Payload Generators
// ==========================================

/** Valid email: standard format, up to 255 chars */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,19}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
    fc.constantFrom('com', 'org', 'net', 'io', 'dev')
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Valid password: 8-128 chars with uppercase, lowercase, digit */
const validPasswordArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,4}$/),
    fc.stringMatching(/^[A-Z]{2,4}$/),
    fc.stringMatching(/^[0-9]{2,3}$/),
    fc.stringMatching(/^[a-zA-Z0-9]{2,50}$/)
  )
  .map(([lower, upper, digit, rest]) => `${lower}${upper}${digit}${rest}`);

/** Valid display name: 1-50 non-empty chars */
const validDisplayNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/** Complete valid registration payload */
const validRegistrationArb = fc.record({
  email: validEmailArb,
  password: validPasswordArb,
  displayName: validDisplayNameArb,
});

/** Invalid email formats */
const invalidEmailArb = fc.oneof(
  fc.constant(''),
  fc.constant('notanemail'),
  fc.constant('missing@'),
  fc.constant('@nodomain.com'),
  fc.constant('spaces in@email.com'),
  fc.constant('no-tld@domain'),
  fc.constant('.leading@dot.com')
);

/** Password that is too short (< 6 chars) */
const shortPasswordArb = fc.string({ minLength: 1, maxLength: 5 });

/** Password that is too long (> 128 chars) */
const longPasswordArb = fc.string({ minLength: 129, maxLength: 200 });

/** Display name that exceeds max length (> 50 chars) */
const longDisplayNameArb = fc.string({ minLength: 51, maxLength: 100 });

/** Invalid registration payload (at least one invalid field) */
const invalidRegistrationArb = fc.oneof(
  // Invalid email
  fc.record({
    email: invalidEmailArb,
    password: validPasswordArb,
    displayName: validDisplayNameArb,
  }),
  // Short password
  fc.record({
    email: validEmailArb,
    password: shortPasswordArb,
    displayName: validDisplayNameArb,
  }),
  // Long display name
  fc.record({
    email: validEmailArb,
    password: validPasswordArb,
    displayName: longDisplayNameArb,
  }),
  // Empty display name
  fc.record({
    email: validEmailArb,
    password: validPasswordArb,
    displayName: fc.constant(''),
  })
);

// ==========================================
// Project Data Generators
// ==========================================

/** Valid project name: 1-100 chars, non-empty */
const validProjectNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

/** Valid project description: 0-500 chars */
const validProjectDescriptionArb = fc.string({ minLength: 0, maxLength: 500 });

/** Complete valid project creation payload */
const validProjectArb = fc.record({
  name: validProjectNameArb,
  description: validProjectDescriptionArb,
});

/** Invalid project name (empty or too long) */
const invalidProjectNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 101, maxLength: 200 })
);

/** Invalid project description (too long) */
const invalidProjectDescriptionArb = fc.string({ minLength: 501, maxLength: 700 });

/** Invalid project payload */
const invalidProjectArb = fc.oneof(
  // Invalid name
  fc.record({
    name: invalidProjectNameArb,
    description: validProjectDescriptionArb,
  }),
  // Invalid description
  fc.record({
    name: validProjectNameArb,
    description: invalidProjectDescriptionArb,
  })
);

// ==========================================
// Task Data Generators
// ==========================================

const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
const validPriorities = ['low', 'medium', 'high', 'urgent'];

/** Valid task status */
const statusArb = fc.constantFrom(...validStatuses);

/** Valid task priority */
const priorityArb = fc.constantFrom(...validPriorities);

/** Valid task title: 1-200 chars, non-empty */
const validTaskTitleArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter(s => s.trim().length > 0);

/** Valid task description: 0-2000 chars */
const validTaskDescriptionArb = fc.string({ minLength: 0, maxLength: 2000 });

/** Valid due date (future ISO string or null) */
const validDueDateArb = fc.option(
  fc.date({ min: new Date(), max: new Date('2030-12-31') }).map(d => d.toISOString()),
  { nil: null }
);

/** Complete valid task creation payload */
const validTaskArb = fc.record({
  title: validTaskTitleArb,
  description: validTaskDescriptionArb,
  status: statusArb,
  priority: priorityArb,
  assigneeId: fc.option(uuidV4Arb, { nil: null }),
  dueDate: validDueDateArb,
});

/** Invalid task title (empty or too long) */
const invalidTaskTitleArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 201, maxLength: 300 })
);

/** Invalid task description (too long) */
const invalidTaskDescriptionArb = fc.string({ minLength: 2001, maxLength: 3000 });

/** Invalid task status */
const invalidStatusArb = fc.oneof(
  fc.constant(''),
  fc.constant('pending'),
  fc.constant('complete'),
  fc.constant('DONE'),
  fc.constant('In Progress'),
  fc.stringMatching(/^[a-z]{3,10}$/).filter(s => !validStatuses.includes(s))
);

/** Invalid task priority */
const invalidPriorityArb = fc.oneof(
  fc.constant(''),
  fc.constant('critical'),
  fc.constant('normal'),
  fc.constant('HIGH'),
  fc.stringMatching(/^[a-z]{3,10}$/).filter(s => !validPriorities.includes(s))
);

/** Invalid task payload (at least one invalid field) */
const invalidTaskArb = fc.oneof(
  // Invalid title
  fc.record({
    title: invalidTaskTitleArb,
    description: validTaskDescriptionArb,
    status: statusArb,
    priority: priorityArb,
  }),
  // Invalid description
  fc.record({
    title: validTaskTitleArb,
    description: invalidTaskDescriptionArb,
    status: statusArb,
    priority: priorityArb,
  }),
  // Invalid status
  fc.record({
    title: validTaskTitleArb,
    description: validTaskDescriptionArb,
    status: invalidStatusArb,
    priority: priorityArb,
  }),
  // Invalid priority
  fc.record({
    title: validTaskTitleArb,
    description: validTaskDescriptionArb,
    status: statusArb,
    priority: invalidPriorityArb,
  })
);

// ==========================================
// File Upload Generators
// ==========================================

const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];
const disallowedExtensions = ['exe', 'bat', 'sh', 'cmd', 'js', 'php', 'py', 'rb', 'dll', 'so', 'bin', 'msi', 'vbs', 'ps1', 'html', 'htm', 'svg', 'swf'];

const allowedExtArb = fc.constantFrom(...allowedExtensions);
const disallowedExtArb = fc.constantFrom(...disallowedExtensions);
const filenameBaseArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/);

// ==========================================
// Comment Generators
// ==========================================

/** Valid comment content: 1-2000 chars */
const validCommentArb = fc
  .string({ minLength: 1, maxLength: 2000 })
  .filter(s => s.trim().length > 0);

/** Invalid comment content */
const invalidCommentArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 2001, maxLength: 3000 })
);

// ==========================================
// Role Generators
// ==========================================

const memberRoleArb = fc.constantFrom('admin', 'member');
const allRolesArb = fc.constantFrom('owner', 'admin', 'member');

// ==========================================
// HTML / Sanitization Generators
// ==========================================

/** Strings containing HTML tags that should be stripped */
const htmlInjectionArb = fc.oneof(
  fc.constant('<script>alert("xss")</script>'),
  fc.constant('<img src=x onerror=alert(1)>'),
  fc.constant('<div onclick="evil()">text</div>'),
  fc.constant('Hello <b>world</b>'),
  fc.constant('<a href="javascript:void(0)">click</a>'),
  fc.tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.constantFrom('script', 'img', 'div', 'iframe', 'object', 'embed'),
    fc.string({ minLength: 1, maxLength: 20 })
  ).map(([before, tag, after]) => `${before}<${tag}>${after}</${tag}>`)
);

/** Path traversal sequences */
const pathTraversalArb = fc.constantFrom(
  '../', '..\\', '../../', '..\\..\\',
  '../../../', '..\\..\\..\\',
  '%2e%2e%2f', '%2e%2e/', '..%2f',
  '....///', '..././'
);

module.exports = {
  // UUIDs
  uuidV4Arb,
  uuidArb,

  // Registration
  validEmailArb,
  validPasswordArb,
  validDisplayNameArb,
  validRegistrationArb,
  invalidEmailArb,
  shortPasswordArb,
  longPasswordArb,
  longDisplayNameArb,
  invalidRegistrationArb,

  // Projects
  validProjectNameArb,
  validProjectDescriptionArb,
  validProjectArb,
  invalidProjectNameArb,
  invalidProjectDescriptionArb,
  invalidProjectArb,

  // Tasks
  validStatuses,
  validPriorities,
  statusArb,
  priorityArb,
  validTaskTitleArb,
  validTaskDescriptionArb,
  validDueDateArb,
  validTaskArb,
  invalidTaskTitleArb,
  invalidTaskDescriptionArb,
  invalidStatusArb,
  invalidPriorityArb,
  invalidTaskArb,

  // File uploads
  allowedExtensions,
  disallowedExtensions,
  allowedExtArb,
  disallowedExtArb,
  filenameBaseArb,

  // Comments
  validCommentArb,
  invalidCommentArb,

  // Roles
  memberRoleArb,
  allRolesArb,

  // Sanitization / Security
  htmlInjectionArb,
  pathTraversalArb,
};
