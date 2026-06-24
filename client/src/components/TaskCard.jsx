import { Clock, AlertTriangle, ArrowUp, Minus } from 'lucide-react';
import { format } from 'date-fns';

const priorityConfig = {
  urgent: { color: 'text-red-600 bg-red-100', label: 'Urgent', icon: AlertTriangle },
  high: { color: 'text-orange-600 bg-orange-100', label: 'High', icon: ArrowUp },
  medium: { color: 'text-yellow-600 bg-yellow-100', label: 'Medium', icon: Minus },
  low: { color: 'text-gray-500 bg-gray-100', label: 'Low', icon: Minus },
};

export default function TaskCard({ task, isOverlay = false }) {
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const PriorityIcon = p.icon;

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-3.5 ${
        isOverlay
          ? 'shadow-xl rotate-2 scale-105 opacity-90'
          : 'hover:shadow-md transition-shadow duration-150'
      }`}
    >
      <h4 className="font-medium text-sm text-gray-900 mb-2">{task.title}</h4>
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${p.color}`}
        >
          <PriorityIcon className="w-3 h-3" />
          {task.priority}
        </span>
        <div className="flex items-center gap-2">
          {task.dueDate && (
            <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
              <Clock className="w-3 h-3" />
              {format(new Date(task.dueDate), 'MMM dd')}
            </span>
          )}
          {task.assignee && (
            <div
              className="w-6 h-6 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-[10px] font-semibold"
              title={task.assignee.displayName}
            >
              {task.assignee.displayName[0]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
