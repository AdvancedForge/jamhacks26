import { useState, useContext, useEffect } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { RoomContext } from '../context/RoomContext';
import { useBoardWebSocket } from '../hooks/useBoardWebSocket';
import { KanbanColumn } from '../components/KanbanColumn';

export const Board = () => {
  const { roomCode } = useContext(RoomContext);
  const [tasks, setTasks] = useState<any[]>([]);

  const handleMessage = (message: any) => {
    switch (message.type) {
      case 'TASK_CREATED':
        setTasks((prev) => [...prev, message.task]);
        break;
      case 'TASK_UPDATED':
        setTasks((prev) => prev.map(t => t.id === message.task.id ? message.task : t));
        break;
      case 'TASK_DELETED':
        setTasks((prev) => prev.filter(t => t.id !== message.task_id));
        break;
    }
  };

  useBoardWebSocket(roomCode, handleMessage);

  useEffect(() => {
    if (roomCode) {
      fetch(`${import.meta.env.VITE_API_BASE_URL}/api/board/${roomCode}`)
          .then(res => res.json())
          .then(data => setTasks(data.tasks));
      }
      }, [roomCode]);

      const onDragEnd = (event: any) => {
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id;
      const newColumn = over.id;
      const task = tasks.find(t => t.id === taskId);
      if (task && task.column !== newColumn) {
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === taskId ? {...t, column: newColumn} : t));
      // API Call
      fetch(`${import.meta.env.VITE_API_BASE_URL}/api/task/${taskId}?room_id=${roomCode}`, {
          method: 'PUT',

            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({...task, column: newColumn})
        });
    }
  };

  const columns = ["Backlog", "In Progress", "Done"];

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex gap-4 p-4 h-full">
        {columns.map(col => (
          <KanbanColumn 
            key={col} 
            title={col} 
            tasks={tasks.filter(t => t.column === col)} 
            onTaskClick={(t) => console.log('Edit task', t)}
            onAddTask={() => console.log('Add task in', col)}
          />
        ))}
      </div>
    </DndContext>
  );
};
