import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Clock, AlertTriangle, ArrowUp, Minus } from 'lucide-react';

const priorityConfig = {
  urgent: { color: 'text-red-600 bg-red-100', icon: AlertTriangle },
  high: { color: 'text-orange-600 bg-orange-100', icon: ArrowUp },
  medium: { color: 'text-yellow-600 bg-yellow-100', icon: Minus },
  low: { color: 'text-gray-500 bg-gray-100', icon: Minus },
};

const statusColors = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  in_review: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
};

export default function TaskRow({ task, index, onClick }) {
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const PriorityIcon = p.icon;

  return (
    <motion.tr
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.03 }}
      onClick={onClick}
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors duration-100"
    >
      <td className="px-4 py-3">
        <span className="font-medium text-gray-900">{task.title}</span>
        {task.description && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{task.description}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[task.status] || 'bg-gray-100 text-gray-600'}`}>
          {task.status?.replace('_', ' ')}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${p.color}`}>
          <PriorityIcon className="w-3 h-3" />
          {task.priority}
        </span>
      </td>
      <td className="px-4 py-3">
        {task.assignee ? (
          <span className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-[10px] font-semibold">
              {task.assignee.displayName[0]}
            </div>
            <span className="text-sm text-gray-600">{task.assignee.displayName}</span>
          </span>
        ) : (
          <span className="text-xs text-gray-400">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        {task.dueDate ? (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            {format(new Date(task.dueDate), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </motion.tr>
  );
}
