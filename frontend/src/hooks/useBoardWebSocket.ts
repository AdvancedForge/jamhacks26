import { useEffect, useRef } from "react";
import { WS_BASE } from "../hackbuddyApi";

export const useBoardWebSocket = (roomCode: string | null, onMessage: (message: any) => void) => {
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomCode) return;
    ws.current = new WebSocket(`${WS_BASE}/ws/board/${roomCode}`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };
    ws.current.onerror = (event) => {
      console.warn("Board websocket error", event);
    };

    return () => {
      ws.current?.close();
    };
  }, [roomCode, onMessage]);

  return ws.current;
};
