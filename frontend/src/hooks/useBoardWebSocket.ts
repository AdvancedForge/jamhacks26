import { useEffect, useRef } from 'react';

export const useBoardWebSocket = (roomCode: string | null, onMessage: (message: any) => void) => {
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    ws.current = new WebSocket(`ws://localhost:8000/ws/board/${roomCode}`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    return () => {
      ws.current?.close();
    };
  }, [roomCode, onMessage]);

  return ws.current;
};
