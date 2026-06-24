import { Filter } from 'lucide-react';

/**
 * FilterBar component for filtering tasks by assignee and priority.
 * Supports combined filter criteria - both filters can be active simultaneously.
 * 
 * @param {Object} props
 * @param {Object} props.filters - Current filter state { priority: string, assignee: string }
 * @param {Function} props.onFilterChange - Callback when any filter value changes
 * @param {Array} props.members - Project members array for the assignee dropdown
 */
export default function FilterBar({ filters, onFilterChange, members = [] }) {
  // Deduplicate members by user id to build unique assignee list
  const uniqueAssignees = [...new Map(members.map(m => [m.user.id, m.user])).values()];

  const handlePriorityChange = (e) => {
    onFilterChange({ ...filters, priority: e.target.value });
  };

  const handleAssigneeChange = (e) => {
    onFilterChange({ ...filters, assignee: e.target.value });
  };

  const hasActiveFilters = filters.priority || filters.assignee;

  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex items-center gap-1.5 text-gray-500 text-sm">
        <Filter className="w-4 h-4" />
        <span className="font-medium">Filters:</span>
      </div>
      <select
        value={filters.priority}
        onChange={handlePriorityChange}
        className="input-field w-auto"
        aria-label="Filter by priority"
      >
        <option value="">All Priorities</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select
        value={filters.assignee}
        onChange={handleAssigneeChange}
        className="input-field w-auto"
        aria-label="Filter by assignee"
      >
        <option value="">All Assignees</option>
        {uniqueAssignees.map(u => (
          <option key={u.id} value={u.id}>{u.displayName}</option>
        ))}
      </select>
      {hasActiveFilters && (
        <button
          onClick={() => onFilterChange({ priority: '', assignee: '' })}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
          aria-label="Clear all filters"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
