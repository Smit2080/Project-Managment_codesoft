import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { LayoutGrid, List, Plus, UserPlus } from 'lucide-react';
import API from '../lib/api';
import toast from 'react-hot-toast';
import KanbanBoard from '../components/KanbanBoard';
import FilterBar from '../components/FilterBar';
import TaskRow from '../components/TaskRow';
import CreateTaskModal from '../components/CreateTaskModal';
import AddMemberModal from '../components/AddMemberModal';

export default function ProjectView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('board');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [filters, setFilters] = useState({ priority: '', assignee: '' });

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => API.get(`/projects/${id}`).then(r => r.data),
  });

  const { data: tasks } = useQuery({
    queryKey: ['tasks', id, filters],
    queryFn: () => API.get(`/tasks/project/${id}`, { params: filters }).then(r => r.data),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, data }) => API.put(`/tasks/${taskId}`, data).then(r => r.data),
    onMutate: async ({ taskId, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['tasks', id, filters] });

      // Snapshot the previous tasks
      const previousTasks = queryClient.getQueryData(['tasks', id, filters]);

      // Optimistically update the task status in the cache
      queryClient.setQueryData(['tasks', id, filters], (old) => {
        if (!old) return old;
        return old.map((task) =>
          task.id === taskId ? { ...task, status: data.status } : task
        );
      });

      // Return context with the previous value for rollback
      return { previousTasks };
    },
    onError: (err, variables, context) => {
      // Rollback to the previous state
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', id, filters], context.previousTasks);
      }

      // Show specific toast for 403 (insufficient permissions)
      if (err.response?.status === 403) {
        toast.error('Insufficient permissions: only the task assignee or a project admin may change the task status');
      } else {
        toast.error(err.response?.data?.message || 'Failed to update task status');
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
    },
  });

  const handleStatusChange = (taskId, newStatus) => {
    updateTaskMutation.mutate({ taskId, data: { status: newStatus } });
  };

  const members = project?.members || [];

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{project?.name}</h1>
          {project?.description && <p className="text-gray-500 text-sm mt-1">{project.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
                view === 'board' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> Board
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
                view === 'list' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <List className="w-4 h-4" /> List
            </button>
          </div>
          <button onClick={() => setShowAddMember(true)} className="btn-secondary flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Add Member
          </button>
          <button onClick={() => setShowCreateTask(true)} className="btn-primary flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> New Task
          </button>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        members={members}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {members.map(m => (
          <span key={m.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full text-xs">
            <div className="w-5 h-5 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-[10px] font-semibold">
              {m.user.displayName[0]}
            </div>
            {m.user.displayName}
            <span className="text-gray-400">({m.role})</span>
          </span>
        ))}
      </div>

      {view === 'board' ? (
        <KanbanBoard
          tasks={tasks || []}
          onStatusChange={handleStatusChange}
          onTaskClick={(taskId) => navigate(`/tasks/${taskId}`)}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Task</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Assignee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {(tasks || []).map((task, i) => (
                <TaskRow key={task.id} task={task} index={i} onClick={() => navigate(`/tasks/${task.id}`)} />
              ))}
              {(!tasks || tasks.length === 0) && (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-gray-400">No tasks found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {showCreateTask && <CreateTaskModal projectId={id} members={members} onClose={() => setShowCreateTask(false)} />}
        {showAddMember && <AddMemberModal projectId={id} members={members} onClose={() => setShowAddMember(false)} />}
      </AnimatePresence>
    </div>
  );
}
