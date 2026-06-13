import { useContext, useState, useEffect, useCallback } from 'react';
import { RoomContext } from '../context/RoomContext';
import { useBoardWebSocket } from '../hooks/useBoardWebSocket';

export const Board = () => {
  const { roomCode } = useContext(RoomContext);
  const [tasks, setTasks] = useState<any[]>([]);

  const handleMessage = useCallback((message: any) => {
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
  }, []);

  useBoardWebSocket(roomCode, handleMessage);

  useEffect(() => {
    if (roomCode) {
        // Fetch initial board state
        fetch(`http://localhost:8000/api/board/${roomCode}`)
            .then(res => res.json())
            .then(data => setTasks(data.tasks));
    }
  }, [roomCode]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Kanban Board ({roomCode})</h1>
      {/* Kanban UI here, using tasks state */}
      <pre>{JSON.stringify(tasks, null, 2)}</pre>
    </div>
  );
};
