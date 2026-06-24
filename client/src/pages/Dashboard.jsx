import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  FolderKanban,
  Users,
  CheckCircle2,
  Archive,
  ClipboardList,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import API from '../lib/api';
import toast from 'react-hot-toast';

function CreateProjectModal({ onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data) => API.post('/projects', data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created');
      onClose();
    },
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Failed to create project'),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">New Project</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="e.g. Website Redesign"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field"
              rows={3}
              placeholder="Optional description..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate({ name, description })}
            disabled={!name || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function ProjectProgressItem({ project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors duration-150"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {project.name}
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${project.progressPercent}%` }}
            />
          </div>
          <span className="text-xs font-medium text-gray-500 w-9 text-right">
            {project.progressPercent}%
          </span>
        </div>
      </div>
      <span className="text-xs text-gray-400">
        {project.doneCount}/{project.taskCount} tasks
      </span>
    </Link>
  );
}

function RecentTaskItem({ task }) {
  const priorityColors = {
    urgent: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  };

  const statusLabels = {
    todo: 'To Do',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
  };

  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors duration-150"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {task.project && (
            <span className="text-xs text-gray-400">{task.project.name}</span>
          )}
          <span className="text-xs text-gray-300">•</span>
          <span className="text-xs text-gray-500">
            {statusLabels[task.status] || task.status}
          </span>
        </div>
      </div>
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
          priorityColors[task.priority] || 'bg-gray-100 text-gray-600'
        }`}
      >
        {task.priority}
      </span>
      {task.assignee && (
        <div
          className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-semibold"
          title={task.assignee.displayName}
        >
          {task.assignee.displayName?.[0]?.toUpperCase() || '?'}
        </div>
      )}
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gray-200 rounded-lg" />
        <div>
          <div className="h-6 bg-gray-200 rounded w-12 mb-1" />
          <div className="h-4 bg-gray-100 rounded w-20" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => API.get('/dashboard').then((r) => r.data),
  });

  const totalProjects = dashboard?.totalProjects ?? 0;
  const totalTasks = dashboard?.totalTasks ?? 0;
  const completedTasks = dashboard?.completedTasks ?? 0;
  const overdueTasks = dashboard?.overdueTasks ?? 0;
  const projects = dashboard?.projects ?? [];
  const recentTasks = dashboard?.recentTasks ?? [];

  const activeProjects = projects.filter((p) => p.status === 'active');
  const archivedProjects = projects.filter((p) => p.status === 'archived');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {totalProjects} project{totalProjects !== 1 ? 's' : ''} overview
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : totalProjects === 0 ? (
        <div className="text-center py-16">
          <FolderKanban className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-1">
            No projects yet
          </h3>
          <p className="text-gray-400 mb-4">
            Create your first project to get started
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary"
          >
            Create Project
          </button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0 }}
            >
              <SummaryCard
                icon={FolderKanban}
                label="Total Projects"
                value={totalProjects}
                color="bg-primary-100 text-primary-700"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.05 }}
            >
              <SummaryCard
                icon={ClipboardList}
                label="Total Tasks"
                value={totalTasks}
                color="bg-blue-100 text-blue-700"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
            >
              <SummaryCard
                icon={CheckCircle2}
                label="Completed"
                value={completedTasks}
                color="bg-green-100 text-green-700"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.15 }}
            >
              <SummaryCard
                icon={AlertTriangle}
                label="Overdue"
                value={overdueTasks}
                color="bg-red-100 text-red-700"
              />
            </motion.div>
          </div>

          {/* Projects and Recent Tasks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Project Progress */}
            <div className="card p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-primary-600" />
                Projects
              </h2>
              {activeProjects.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No active projects
                </p>
              ) : (
                <div className="space-y-1">
                  {activeProjects.map((project) => (
                    <ProjectProgressItem
                      key={project.id}
                      project={project}
                    />
                  ))}
                </div>
              )}

              {archivedProjects.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <Archive className="w-3.5 h-3.5" /> Archived (
                    {archivedProjects.length})
                  </p>
                  <div className="space-y-1">
                    {archivedProjects.map((project) => (
                      <ProjectProgressItem
                        key={project.id}
                        project={project}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Recent Tasks */}
            <div className="card p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                Recent Tasks
              </h2>
              {recentTasks.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  No tasks yet
                </p>
              ) : (
                <div className="space-y-1">
                  {recentTasks.map((task) => (
                    <RecentTaskItem key={task.id} task={task} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateProjectModal onClose={() => setShowCreate(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
