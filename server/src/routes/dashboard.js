const express = require('express');
const auth = require('../middleware/auth');
const prisma = require('../config/database');

const router = express.Router();

// GET /api/dashboard - Dashboard aggregates
router.get('/', auth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get all projects where user is a member
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });

    const projectIds = memberships.map((m) => m.projectId);

    // Total projects count
    const totalProjects = projectIds.length;

    // Total tasks assigned to user across their projects
    const totalTasks = await prisma.task.count({
      where: {
        assigneeId: userId,
        projectId: { in: projectIds },
      },
    });

    // Completed tasks (status = done, assigned to user)
    const completedTasks = await prisma.task.count({
      where: {
        assigneeId: userId,
        projectId: { in: projectIds },
        status: 'done',
      },
    });

    // Overdue tasks (dueDate < now AND status != done)
    const overdueTasks = await prisma.task.count({
      where: {
        assigneeId: userId,
        projectId: { in: projectIds },
        status: { not: 'done' },
        dueDate: { lt: new Date() },
      },
    });

    // Get projects with per-project progress
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        name: true,
        status: true,
        tasks: {
          select: { status: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const projectsWithProgress = projects.map((project) => {
      const taskCount = project.tasks.length;
      const doneCount = project.tasks.filter((t) => t.status === 'done').length;
      const progressPercent = taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100);

      return {
        id: project.id,
        name: project.name,
        status: project.status,
        taskCount,
        doneCount,
        progressPercent,
      };
    });

    // 10 most recently updated tasks across user's projects
    const recentTasks = await prisma.task.findMany({
      where: {
        projectId: { in: projectIds },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: {
        assignee: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
        creator: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    res.json({
      totalProjects,
      totalTasks,
      completedTasks,
      overdueTasks,
      projects: projectsWithProgress,
      recentTasks,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
