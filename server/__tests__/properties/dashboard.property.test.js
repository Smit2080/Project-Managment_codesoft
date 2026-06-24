const fc = require('fast-check');
const express = require('express');
const request = require('supertest');

// Mock auth middleware to bypass JWT verification in tests
jest.mock('../../src/middleware/auth', () => {
  return (req, res, next) => {
    if (req.headers['x-test-user-id']) {
      req.user = {
        id: req.headers['x-test-user-id'],
        email: 'test@test.com',
        displayName: 'Test User',
      };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'No token provided', statusCode: 401 });
  };
});

// Mock Prisma client
jest.mock('../../src/config/database', () => ({
  projectMember: {
    findMany: jest.fn(),
  },
  task: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
  },
}));

const prisma = require('../../src/config/database');

// Create a test app with dashboard routes
function createApp() {
  const app = express();
  app.use(express.json());
  const dashboardRoutes = require('../../src/routes/dashboard');
  app.use('/api/dashboard', dashboardRoutes);
  return app;
}

describe('Dashboard Aggregation - Property Tests', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Generators ---
  const uuidArb = fc.uuid().filter(u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u));
  const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
  const statusArb = fc.constantFrom(...validStatuses);

  // Generator for a list of tasks with statuses (simulating per-project tasks)
  const taskStatusListArb = fc.array(statusArb, { minLength: 0, maxLength: 50 });

  // Generator for a project with tasks
  const projectWithTasksArb = fc.record({
    id: uuidArb,
    name: fc.string({ minLength: 1, maxLength: 100 }),
    status: fc.constantFrom('active', 'archived'),
    taskStatuses: taskStatusListArb,
  });

  // Generator for multiple projects
  const projectsArb = fc.array(projectWithTasksArb, { minLength: 0, maxLength: 10 });

  /**
   * Property 19: Dashboard progress calculation
   *
   * For any project with T total tasks and D tasks with status "done",
   * the dashboard SHALL display progress as round(D/T × 100)%.
   * For projects with 0 tasks, progress SHALL be 0%.
   *
   * **Validates: Requirements 10.2, 10.4**
   */
  describe('Property 19: Dashboard progress calculation', () => {
    it('progressPercent equals round(doneCount / taskCount * 100) or 0 when no tasks', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectsArb,
          uuidArb,
          async (projects, userId) => {
            jest.clearAllMocks();

            // Set up project memberships
            const memberships = projects.map(p => ({ projectId: p.id }));
            prisma.projectMember.findMany.mockResolvedValue(memberships);

            // Set up task counts (these are for the user summary, not per-project)
            prisma.task.count.mockResolvedValue(0);

            // Set up project data with tasks
            const projectsDbResult = projects.map(p => ({
              id: p.id,
              name: p.name,
              status: p.status,
              tasks: p.taskStatuses.map(status => ({ status })),
            }));
            prisma.project.findMany.mockResolvedValue(projectsDbResult);

            // Mock recent tasks
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);

            // Verify each project's progressPercent
            for (let i = 0; i < projects.length; i++) {
              const project = projects[i];
              const returnedProject = res.body.projects.find(p => p.id === project.id);
              expect(returnedProject).toBeDefined();

              const taskCount = project.taskStatuses.length;
              const doneCount = project.taskStatuses.filter(s => s === 'done').length;
              const expectedProgress = taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100);

              expect(returnedProject.progressPercent).toBe(expectedProgress);
              expect(returnedProject.taskCount).toBe(taskCount);
              expect(returnedProject.doneCount).toBe(doneCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('projects with zero tasks always have 0% progress', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: uuidArb,
              name: fc.string({ minLength: 1, maxLength: 100 }),
              status: fc.constantFrom('active', 'archived'),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          uuidArb,
          async (emptyProjects, userId) => {
            jest.clearAllMocks();

            const memberships = emptyProjects.map(p => ({ projectId: p.id }));
            prisma.projectMember.findMany.mockResolvedValue(memberships);
            prisma.task.count.mockResolvedValue(0);

            // All projects have zero tasks
            const projectsDbResult = emptyProjects.map(p => ({
              id: p.id,
              name: p.name,
              status: p.status,
              tasks: [],
            }));
            prisma.project.findMany.mockResolvedValue(projectsDbResult);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);

            for (const returnedProject of res.body.projects) {
              expect(returnedProject.progressPercent).toBe(0);
              expect(returnedProject.taskCount).toBe(0);
              expect(returnedProject.doneCount).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('projects with all tasks done have 100% progress', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }),
          uuidArb,
          uuidArb,
          async (taskCount, projectId, userId) => {
            jest.clearAllMocks();

            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);
            prisma.task.count.mockResolvedValue(0);

            // All tasks are "done"
            const tasks = Array(taskCount).fill({ status: 'done' });
            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks,
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.projects[0].progressPercent).toBe(100);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('progress percentage is always between 0 and 100 inclusive', async () => {
      await fc.assert(
        fc.asyncProperty(
          projectsArb,
          uuidArb,
          async (projects, userId) => {
            jest.clearAllMocks();

            const memberships = projects.map(p => ({ projectId: p.id }));
            prisma.projectMember.findMany.mockResolvedValue(memberships);
            prisma.task.count.mockResolvedValue(0);

            const projectsDbResult = projects.map(p => ({
              id: p.id,
              name: p.name,
              status: p.status,
              tasks: p.taskStatuses.map(status => ({ status })),
            }));
            prisma.project.findMany.mockResolvedValue(projectsDbResult);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);

            for (const project of res.body.projects) {
              expect(project.progressPercent).toBeGreaterThanOrEqual(0);
              expect(project.progressPercent).toBeLessThanOrEqual(100);
              // Must be an integer (rounded)
              expect(Number.isInteger(project.progressPercent)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20: Dashboard overdue task count
   *
   * For any set of user tasks, the overdue count SHALL equal the number of tasks
   * where dueDate < currentDate AND status ≠ "done".
   *
   * **Validates: Requirements 10.1, 10.2, 10.4**
   */
  describe('Property 20: Dashboard overdue task count', () => {
    // Generate tasks with random due dates and statuses
    const taskWithDueDateArb = fc.record({
      id: uuidArb,
      status: statusArb,
      dueDate: fc.option(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        { nil: null }
      ),
    });

    const taskListArb = fc.array(taskWithDueDateArb, { minLength: 0, maxLength: 30 });

    it('overdue count matches tasks where dueDate < now AND status != done', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          uuidArb,
          uuidArb,
          async (tasks, projectId, userId) => {
            jest.clearAllMocks();

            const now = new Date();

            // Calculate expected overdue count
            const expectedOverdueCount = tasks.filter(
              t => t.dueDate !== null && t.dueDate < now && t.status !== 'done'
            ).length;

            // Set up mocks
            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);

            // The dashboard route calls prisma.task.count 3 times:
            // 1. totalTasks (assigned to user)
            // 2. completedTasks (status = done)
            // 3. overdueTasks (dueDate < now AND status != done)
            prisma.task.count
              .mockResolvedValueOnce(tasks.length) // totalTasks
              .mockResolvedValueOnce(tasks.filter(t => t.status === 'done').length) // completedTasks
              .mockResolvedValueOnce(expectedOverdueCount); // overdueTasks

            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks: tasks.map(t => ({ status: t.status })),
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.overdueTasks).toBe(expectedOverdueCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tasks with status "done" are never counted as overdue regardless of dueDate', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: uuidArb,
              status: fc.constant('done'),
              dueDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2023-01-01') }), // always in the past
            }),
            { minLength: 1, maxLength: 20 }
          ),
          uuidArb,
          uuidArb,
          async (doneTasks, projectId, userId) => {
            jest.clearAllMocks();

            // All tasks are done with past due dates - none should be overdue
            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);
            prisma.task.count
              .mockResolvedValueOnce(doneTasks.length) // totalTasks
              .mockResolvedValueOnce(doneTasks.length) // completedTasks (all done)
              .mockResolvedValueOnce(0); // overdueTasks (none, because all done)

            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks: doneTasks.map(t => ({ status: t.status })),
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.overdueTasks).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tasks with no dueDate are never counted as overdue', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: uuidArb,
              status: fc.constantFrom('todo', 'in_progress', 'in_review'),
              dueDate: fc.constant(null),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          uuidArb,
          uuidArb,
          async (tasksNoDueDate, projectId, userId) => {
            jest.clearAllMocks();

            // No task has a due date - none should be overdue
            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);
            prisma.task.count
              .mockResolvedValueOnce(tasksNoDueDate.length) // totalTasks
              .mockResolvedValueOnce(0) // completedTasks
              .mockResolvedValueOnce(0); // overdueTasks (none, no dueDate)

            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks: tasksNoDueDate.map(t => ({ status: t.status })),
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.overdueTasks).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tasks with future dueDate are never counted as overdue', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: uuidArb,
              status: fc.constantFrom('todo', 'in_progress', 'in_review'),
              dueDate: fc.date({ min: new Date('2028-01-01'), max: new Date('2030-12-31') }), // always in the future
            }),
            { minLength: 1, maxLength: 20 }
          ),
          uuidArb,
          uuidArb,
          async (futureTasks, projectId, userId) => {
            jest.clearAllMocks();

            // All tasks have future due dates - none should be overdue
            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);
            prisma.task.count
              .mockResolvedValueOnce(futureTasks.length) // totalTasks
              .mockResolvedValueOnce(0) // completedTasks
              .mockResolvedValueOnce(0); // overdueTasks (none, all future)

            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks: futureTasks.map(t => ({ status: t.status })),
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.overdueTasks).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('overdue count correctly handles mixed task scenarios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10 }), // past non-done tasks (overdue)
          fc.integer({ min: 0, max: 10 }), // past done tasks (not overdue)
          fc.integer({ min: 0, max: 10 }), // future non-done tasks (not overdue)
          fc.integer({ min: 0, max: 10 }), // no-dueDate tasks (not overdue)
          uuidArb,
          uuidArb,
          async (pastNonDoneCount, pastDoneCount, futureCount, noDueDateCount, projectId, userId) => {
            jest.clearAllMocks();

            const totalTaskCount = pastNonDoneCount + pastDoneCount + futureCount + noDueDateCount;
            const doneCount = pastDoneCount;
            const expectedOverdue = pastNonDoneCount; // Only past non-done are overdue

            prisma.projectMember.findMany.mockResolvedValue([{ projectId }]);
            prisma.task.count
              .mockResolvedValueOnce(totalTaskCount)
              .mockResolvedValueOnce(doneCount)
              .mockResolvedValueOnce(expectedOverdue);

            // Build task statuses for project progress
            const taskStatuses = [
              ...Array(pastNonDoneCount).fill({ status: 'todo' }),
              ...Array(pastDoneCount).fill({ status: 'done' }),
              ...Array(futureCount).fill({ status: 'in_progress' }),
              ...Array(noDueDateCount).fill({ status: 'in_review' }),
            ];

            prisma.project.findMany.mockResolvedValue([{
              id: projectId,
              name: 'Test Project',
              status: 'active',
              tasks: taskStatuses,
            }]);
            prisma.task.findMany.mockResolvedValue([]);

            const res = await request(app)
              .get('/api/dashboard')
              .set('x-test-user-id', userId);

            expect(res.status).toBe(200);
            expect(res.body.overdueTasks).toBe(expectedOverdue);
            expect(res.body.totalTasks).toBe(totalTaskCount);
            expect(res.body.completedTasks).toBe(doneCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
