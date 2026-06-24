const fs = require('fs');
const path = require('path');

/**
 * Audit Logger Service
 * 
 * Writes structured JSON log entries for security-relevant events.
 * Fire-and-forget: never blocks the triggering operation.
 * On write failure, logs to stderr within 5 seconds.
 * Never includes passwords, tokens, or request/response bodies.
 */

// Sensitive fields that must never appear in audit logs
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'authorization', 'cookie', 'session', 'body'];

/**
 * Strips any sensitive data from an entry object.
 * Returns a clean object with only allowed audit fields.
 */
function sanitizeEntry(entry) {
  return {
    timestamp: entry.timestamp,
    userId: entry.userId,
    ip: entry.ip,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    outcome: entry.outcome
  };
}

/**
 * Returns the configured audit log file path.
 */
function getLogPath() {
  return process.env.AUDIT_LOG_PATH || './logs/audit.log';
}

/**
 * Ensures the directory for the log file exists.
 */
function ensureLogDirectory(logPath) {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Logs a security-relevant audit event.
 * 
 * Fire-and-forget: this function never throws and never blocks the caller.
 * On write failure, the error is logged to stderr within 5 seconds.
 * 
 * @param {Object} entry - The audit entry
 * @param {string} entry.userId - User ID or "anonymous" for unauthenticated requests
 * @param {string} entry.ip - Client IP address
 * @param {string} entry.action - Action type (e.g., "login_success", "login_failed")
 * @param {string} entry.resourceType - Target resource type (e.g., "user", "project")
 * @param {string} entry.resourceId - Target resource ID
 * @param {string} entry.outcome - "success" or "failure"
 */
function logAudit(entry) {
  try {
    const logPath = getLogPath();

    // Build sanitized log entry with UTC timestamp
    const sanitized = sanitizeEntry(entry);
    sanitized.timestamp = new Date().toISOString();

    const logLine = JSON.stringify(sanitized) + '\n';

    // Ensure log directory exists
    ensureLogDirectory(logPath);

    // Append asynchronously — fire-and-forget
    fs.appendFile(logPath, logLine, (err) => {
      if (err) {
        // On write failure, log to stderr within 5 seconds
        process.stderr.write(
          `[AUDIT_LOG_ERROR] Failed to write audit log: ${err.message}\n`
        );
      }
    });
  } catch (err) {
    // Catch any synchronous errors (e.g., directory creation failure)
    // Log to stderr — never throw, never block the caller
    process.stderr.write(
      `[AUDIT_LOG_ERROR] Failed to write audit log: ${err.message}\n`
    );
  }
}

module.exports = {
  logAudit,
  // Exported for testing purposes
  sanitizeEntry,
  getLogPath,
  ensureLogDirectory
};
