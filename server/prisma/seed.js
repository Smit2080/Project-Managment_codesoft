const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('password123', 12);

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: { email: 'alice@example.com', passwordHash, displayName: 'Alice Johnson' },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: { email: 'bob@example.com', passwordHash, displayName: 'Bob Smith' },
  });

  const carol = await prisma.user.upsert({
    where: { email: 'carol@example.com' },
    update: {},
    create: { email: 'carol@example.com', passwordHash, displayName: 'Carol Davis' },
  });

  console.log('Users created:', { alice: alice.id, bob: bob.id, carol: carol.id });

  const project = await prisma.project.create({
    data: {
      name: 'ProjectFlow MVP',
      description: 'Build the initial version of ProjectFlow project management tool',
      ownerId: alice.id,
      members: {
        create: [
          { userId: alice.id, role: 'owner' },
          { userId: bob.id, role: 'admin' },
          { userId: carol.id, role: 'member' },
        ],
      },
    },
  });

  console.log('Project created:', project.id);

  const tasks = [
    { title: 'Design database schema', description: 'Create Prisma schema for all models', status: 'done', priority: 'high', assigneeId: alice.id },
    { title: 'Set up Express server', description: 'Configure Express with CORS, JSON parsing, and routes', status: 'done', priority: 'high', assigneeId: alice.id },
    { title: 'Implement JWT auth', description: 'Register, login, and auth middleware', status: 'done', priority: 'high', assigneeId: bob.id },
    { title: 'Build project CRUD', description: 'Create, read, update, delete projects with member management', status: 'in_progress', priority: 'high', assigneeId: alice.id },
    { title: 'Build task CRUD', description: 'Tasks with comments and attachments', status: 'in_progress', priority: 'high', assigneeId: bob.id },
    { title: 'Create React dashboard', description: 'Project list with cards and create modal', status: 'in_progress', priority: 'medium', assigneeId: carol.id },
    { title: 'Build Kanban board', description: 'Drag-and-drop task board with DnD Kit', status: 'in_review', priority: 'medium', assigneeId: carol.id },
    { title: 'Add notification polling', description: 'Poll notifications every 30s with bell icon', status: 'todo', priority: 'medium', assigneeId: bob.id },
    { title: 'Write seed script', description: 'Demo data for testing', status: 'todo', priority: 'low', assigneeId: alice.id },
    { title: 'Set up Docker', description: 'Dockerfile and docker-compose for deployment', status: 'todo', priority: 'low', assigneeId: alice.id },
    { title: 'Add file upload', description: 'Multer-based file uploads for task attachments', status: 'todo', priority: 'medium', assigneeId: bob.id },
    { title: 'Settings page', description: 'Profile edit and password change', status: 'todo', priority: 'low', assigneeId: carol.id },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        projectId: project.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assigneeId,
        createdBy: alice.id,
        dueDate: t.status === 'todo' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
      },
    });
  }

  console.log('Tasks created:', tasks.length);

  await prisma.notification.createMany({
    data: [
      { userId: alice.id, type: 'task_assigned', message: 'You were assigned "Build project CRUD"' },
      { userId: carol.id, type: 'task_assigned', message: 'You were assigned "Create React dashboard"' },
      { userId: carol.id, type: 'task_assigned', message: 'You were assigned "Build Kanban board"' },
      { userId: bob.id, type: 'task_comment', message: 'Alice commented on "Set up Express server"' },
    ],
  });

  console.log('Notifications created');
  console.log('Seed complete! Login with alice@example.com / password123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
