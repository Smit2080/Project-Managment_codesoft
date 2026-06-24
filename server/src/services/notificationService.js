const prisma = require('../config/database');

/**
 * Create a notification record in the database.
 * @param {Object} payload
 * @param {string} payload.userId - The user to notify
 * @param {string} payload.type - One of: task_assigned, project_member_added, task_comment
 * @param {string} payload.message - Human-readable notification message
 * @param {string} [payload.relatedTaskId] - Optional related task ID
 * @returns {Promise<Object>} The created notification
 */
async function createNotification(payload) {
  const { userId, type, message, relatedTaskId } = payload;

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      message,
      relatedTaskId: relatedTaskId || null,
    },
  });

  return notification;
}

/**
 * Notify the assignee that a task has been assigned to them.
 * Skips notification if the actor is the assignee (self-assignment).
 * @param {Object} task - Task object with at least id, title, assigneeId
 * @param {string} actorId - The user who performed the assignment
 */
async function notifyTaskAssigned(task, actorId) {
  if (!task.assigneeId) return;
  if (task.assigneeId === actorId) return;

  await createNotification({
    userId: task.assigneeId,
    type: 'task_assigned',
    message: `You have been assigned to task "${task.title}"`,
    relatedTaskId: task.id,
  });
}

/**
 * Notify a user that they have been added to a project.
 * @param {string} projectName - The name of the project
 * @param {string} userId - The user who was added
 * @param {string} role - The role assigned to the user
 */
async function notifyMemberAdded(projectName, userId, role) {
  await createNotification({
    userId,
    type: 'project_member_added',
    message: `You have been added to project "${projectName}" as ${role}`,
  });
}

/**
 * Notify the task assignee and creator that a comment was posted.
 * Excludes the commenter from notifications. Deduplicates if assignee === creator.
 * @param {Object} task - Task object with at least id, title, assigneeId, createdBy
 * @param {string} commenterId - The user who posted the comment
 */
async function notifyTaskComment(task, commenterId) {
  const recipientIds = new Set();

  if (task.assigneeId && task.assigneeId !== commenterId) {
    recipientIds.add(task.assigneeId);
  }

  if (task.createdBy && task.createdBy !== commenterId) {
    recipientIds.add(task.createdBy);
  }

  const notifications = [...recipientIds].map((userId) =>
    createNotification({
      userId,
      type: 'task_comment',
      message: `New comment on task "${task.title}"`,
      relatedTaskId: task.id,
    })
  );

  await Promise.all(notifications);
}

module.exports = {
  createNotification,
  notifyTaskAssigned,
  notifyMemberAdded,
  notifyTaskComment,
};
