import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { Clock, AlertTriangle, ArrowUp, Minus } from 'lucide-react';
import { format } from 'date-fns';

const priorityConfig = {
  urgent: { color: 'text-red-600 bg-red-100', icon: AlertTriangle },
  high: { color: 'text-orange-600 bg-orange-100', icon: ArrowUp },
  medium: { color: 'text-yellow-600 bg-yellow-100', icon: Minus },
  low: { color: 'text-gray-500 bg-gray-100', icon: Minus },
};

const statusLabels = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function SortableTaskCard({ task, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { columnId: task.status } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const PriorityIcon = p.icon;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-3.5 cursor-pointer hover:shadow-md transition-shadow duration-150"
    >
      <h4 className="font-medium text-sm text-gray-900 mb-2">{task.title}</h4>
      {task.description && (
        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${p.color}`}>
            <PriorityIcon className="w-3 h-3" />
            {task.priority}
          </span>
          {task._count?.comments > 0 && (
            <span className="text-[10px] text-gray-400">{task._count.comments} comments</span>
          )}
          {task._count?.attachments > 0 && (
            <span className="text-[10px] text-gray-400">{task._count.attachments} files</span>
          )}
        </div>
        {(task.assignee || task.dueDate) && (
          <div className="flex items-center gap-2">
            {task.dueDate && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                <Clock className="w-3 h-3" />
                {format(new Date(task.dueDate), 'MMM d')}
              </span>
            )}
            {task.assignee && (
              <div className="w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-[10px] font-semibold" title={task.assignee.displayName}>
                {task.assignee.displayName[0]}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function KanbanColumn({ column, tasks, onTaskClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { columnId: column.id } });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl p-3 min-h-[200px] transition-colors duration-150 ${column.color} ${isOver ? 'ring-2 ring-primary-300' : ''}`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-sm font-semibold text-gray-700">{column.label}</h3>
        <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full">{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.map(task => (
          <SortableTaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">Drop tasks here</p>
        )}
      </div>
    </div>
  );
}
