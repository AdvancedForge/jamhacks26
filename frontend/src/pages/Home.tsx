import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoomContext } from '../context/RoomContext';

export const Home = () => {
  const { setRoomCode } = useContext(RoomContext);
  const [inputCode, setInputCode] = useState('');
  const navigate = useNavigate();

  const handleAction = async (create: boolean) => {
    if (create) {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/room/create`, { method: 'POST' });
        const data = await res.json();
        setRoomCode(data.room_id);
    } else {
        setRoomCode(inputCode);
    }
    navigate('/board');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center">
      <h1 className="text-5xl font-extrabold text-blue-400 mb-6">HackBuddy</h1>
      <p className="text-gray-400 mb-8 max-w-md">Your real-time hackathon co-pilot. Create a room or join an existing one to get started.</p>
      <div className="flex gap-2">
        <input 
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          placeholder="Enter Room Code"
          className="bg-gray-800 border border-gray-700 px-4 py-2 rounded text-white"
        />
        <button onClick={() => handleAction(false)} className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-500">Join</button>
        <button onClick={() => handleAction(true)} className="bg-gray-700 px-4 py-2 rounded hover:bg-gray-600">Create New Room</button>
      </div>
    </div>
  );
};
