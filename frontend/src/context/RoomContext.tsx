import { createContext, useState, type ReactNode } from 'react';

export const RoomContext = createContext<{ roomCode: string | null; setRoomCode: (code: string) => void }>({
  roomCode: null,
  setRoomCode: () => {},
});

export const RoomProvider = ({ children }: { children: ReactNode }) => {
  const [roomCode, setRoomCode] = useState<string | null>(localStorage.getItem('roomCode'));

  const updateRoomCode = (code: string) => {
    setRoomCode(code);
    localStorage.setItem('roomCode', code);
  };

  return (
    <RoomContext.Provider value={{ roomCode, setRoomCode: updateRoomCode }}>
      {children}
    </RoomContext.Provider>
  );
};
