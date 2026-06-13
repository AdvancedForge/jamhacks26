import { useState } from "react";
import EntryScreen from "./components/EntryScreen";
import ToastList from "./components/ToastList";
import Topbar from "./components/Topbar";
import { useToasts } from "./hooks/useToasts";
import type { AppPage } from "./hackbuddyTypes";
import BoardPage from "./pages/Board";
import WhiteboardPage from "./pages/Whiteboard";
import IntegrationsPage from "./pages/Integrations";

export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("hb_room") || "");
  const [page, setPage] = useState<AppPage>("Board");
  const [polledAt, setPolledAt] = useState(Date.now());
  const { toasts, add: toast } = useToasts();

  const handleEnter = (code: string) => {
    setRoomCode(code);
    setPage("Board");
  };

  if (!roomCode) {
    return (
      <>
        <EntryScreen onEnter={handleEnter} />
        <ToastList toasts={toasts} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#08090a] text-white overflow-hidden">
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawer {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-up  { animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-drawer    { animation: drawer 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>

      <Topbar roomCode={roomCode} page={page} onNav={setPage} polledAt={polledAt} />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {page === "Board" && <BoardPage roomCode={roomCode} toast={toast} onPoll={() => setPolledAt(Date.now())} />}
        {page === "Whiteboard" && <WhiteboardPage roomCode={roomCode} toast={toast} />}
        {page === "Integrations" && <IntegrationsPage roomCode={roomCode} toast={toast} />}
      </main>

      <ToastList toasts={toasts} />
    </div>
  );
}
