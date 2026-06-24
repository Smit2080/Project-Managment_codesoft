# TaskFlow - Project Management System

A full-stack project management application featuring kanban boards, team collaboration, role-based access control (RBAC), and real-time notifications. Built for teams that need a clean, efficient way to organize work and track progress.

## Features

- **Kanban Board** — Drag-and-drop task management with customizable columns
- **Team Management** — Invite members, assign roles (Admin, Manager, Member, Viewer)
- **Task Comments & File Attachments** — Collaborate directly on tasks with threaded comments and file uploads
- **Real-time Notifications** — Stay updated on task assignments, comments, and project changes
- **Dashboard & Analytics** — Visual overview of project progress, task distribution, and team activity
- **Command Palette** — Quick navigation and actions via keyboard shortcut

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, TailwindCSS |
| Backend | Express.js, Node.js |
| Database | PostgreSQL, Prisma ORM |
| Auth | JWT-based authentication |
| File Storage | Local filesystem (configurable) |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/CodeSoft/taskflow.git
cd taskflow

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Environment Setup

```bash
# Copy the example env file and fill in your values
cp server/.env.example server/.env
```

Edit `server/.env` with your database credentials and secrets.

### Database Setup

```bash
cd server

# Run migrations
npx prisma migrate deploy

# Seed the database with sample data
npx prisma db seed
```

### Running the App

```bash
# Start the backend (from server/)
cd server
npm run dev

# Start the frontend (from client/)
cd client
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API requests to the backend on port 5000.

## Deployment

### Frontend (Vercel)

The frontend is configured for Vercel deployment via `vercel.json`. Set the `VITE_API_URL` environment variable in your Vercel project settings to point to your deployed backend URL (e.g., `https://api.yourdomain.com/api`).

### Backend (Railway / Render / VPS)

The backend needs to be deployed separately to a platform that supports Node.js and PostgreSQL:

1. Deploy to [Railway](https://railway.app), [Render](https://render.com), or your own VPS
2. Set all environment variables from `.env.example`
3. Run `npx prisma migrate deploy` to set up the database
4. Ensure `CORS_ORIGINS` includes your frontend domain

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret key for token signing | `your-secure-random-string` |
| `PORT` | Backend server port | `5000` |
| `CORS_ORIGINS` | Allowed frontend origins | `http://localhost:5173` |
| `UPLOAD_DIR` | File upload directory | `./uploads` |
| `AUDIT_LOG_PATH` | Path to audit log file | `./logs/audit.log` |

See `server/.env.example` for the full list including optional SMTP settings.

## Project Structure

```
taskflow/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page-level components
│   │   ├── store/           # Zustand state management
│   │   ├── lib/             # API client and utilities
│   │   └── hooks/           # Custom React hooks
│   └── vite.config.js
├── server/                  # Express backend
│   ├── src/
│   │   ├── routes/          # API route handlers
│   │   ├── middleware/      # Auth, validation, error handling
│   │   ├── services/        # Business logic (notifications, audit)
│   │   └── config/          # App configuration
│   ├── prisma/
│   │   ├── schema.prisma    # Database schema
│   │   ├── migrations/      # Database migrations
│   │   └── seed.js          # Seed data
│   └── uploads/             # File attachments storage
├── docker-compose.yml       # Docker development setup
├── Dockerfile
└── vercel.json              # Vercel frontend deployment config
```

## License

MIT — see [LICENSE](./LICENSE) for details.
