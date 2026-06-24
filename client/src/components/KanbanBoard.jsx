import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import KanbanColumn from './KanbanColumn';
import TaskCard from './TaskCard';

const COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'bg-gray-100' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-blue-50' },
  { id: 'in_review', label: 'In Review', color: 'bg-amber-50' },
  { id: 'done', label: 'Done', color: 'bg-green-50' },
];

export default function KanbanBoard({ tasks, onStatusChange, onTaskClick }) {
  const [activeTask, setActiveTask] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const tasksByColumn = useMemo(() => {
    const map = {};
    COLUMNS.forEach((c) => {
      map[c.id] = [];
    });
    (tasks || []).forEach((t) => {
      if (map[t.status]) map[t.status].push(t);
    });
    return map;
  }, [tasks]);

  const handleDragStart = useCallback(
    (event) => {
      const { active } = event;
      const task = (tasks || []).find((t) => t.id === active.id);
      setActiveTask(task || null);
    },
    [tasks]
  );

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) return;

      const taskId = active.id;
      const newStatus = over.data.current?.columnId;
      if (!newStatus) return;

      const task = (tasks || []).find((t) => t.id === taskId);
      if (!task || task.status === newStatus) return;

      onStatusChange(taskId, newStatus);
    },
    [tasks, onStatusChange]
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <SortableContext
            key={col.id}
            items={tasksByColumn[col.id]?.map((t) => t.id) || []}
            strategy={verticalListSortingStrategy}
          >
            <KanbanColumn
              column={col}
              tasks={tasksByColumn[col.id] || []}
              onTaskClick={onTaskClick}
            />
          </SortableContext>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
