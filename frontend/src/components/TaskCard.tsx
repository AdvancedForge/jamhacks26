import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const TaskCard = ({ task, onClick }: { task: any, onClick: () => void }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="p-3 mb-2 bg-gray-800 rounded shadow hover:bg-gray-700 cursor-pointer"
    >
      <h3 className="font-semibold text-sm text-gray-100">{task.title}</h3>
      {task.description && <p className="text-xs text-gray-400 mt-1">{task.description}</p>}
    </div>
  );
};
