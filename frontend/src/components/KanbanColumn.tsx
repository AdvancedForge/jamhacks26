import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { TaskCard } from "./TaskCard";

export const KanbanColumn = ({ title, tasks, onTaskClick, onAddTask }: { title: string, tasks: any[], onTaskClick: (task: any) => void, onAddTask: () => void }) => {
  const { setNodeRef } = useDroppable({ id: title });

  return (
    <div className="flex flex-col w-1/3 bg-gray-950 p-4 rounded-lg">
      <h2 className="font-bold text-gray-300 mb-4">{title} ({tasks.length})</h2>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-grow min-h-[200px]">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </div>
      </SortableContext>
      <button onClick={onAddTask} className="mt-2 text-xs text-gray-500 hover:text-blue-400">
        + Add task
      </button>
    </div>
  );
};
