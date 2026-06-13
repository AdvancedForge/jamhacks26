import { useCallback, useEffect, useState, useContext } from "react";
import type { DragEvent } from "react";
import { API_BASE, apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";
import { COLUMNS, Column, type CreateTaskInput, TaskDrawer } from "../components/BoardUI";
import { RoomContext } from '../context/RoomContext';
import { useBoardWebSocket } from '../hooks/useBoardWebSocket';
import { ChatWindow } from '../components/ChatWindow';

export default function BoardPage({
  toast,
}: {
  toast: ToastFn;
}) {
  const { roomCode } = useContext(RoomContext);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [drawer, setDrawer] = useState<Task | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);

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
      case 'CHAT_MESSAGE':
        setChatMessages((prev) => [...prev, message.message]);
        break;
    }
  }, []);

  useBoardWebSocket(roomCode || "", handleMessage);

  const fetchBoard = useCallback(async () => {
    try {
      const data = await apiFetch<{ tasks?: Task[] }>(`/api/board/${roomCode}`);
      setTasks((data.tasks || []).filter((task) => !task.deleted));
    } catch {
      toast("Failed to load board.", "error");
    }
  }, [roomCode, toast]);

  useEffect(() => {
    if (roomCode) fetchBoard();
  }, [fetchBoard, roomCode]);

  const handleAdd = async ({ title, description, column }: CreateTaskInput) => {
    const now = Date.now();
    try {
      await apiFetch(`/api/task/create?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ title, description, column, assignee: "", created_at: now }),
      });
      toast(`Task added to ${column}`);
    } catch {
      toast("Failed to save task.", "error");
    }
  };

  const handleSave = async (updated: Task) => {
    try {
      await apiFetch(`/api/task/${updated.id}?room_id=${roomCode}`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
      if (drawer) setDrawer(updated);
    } catch {
      toast("Couldn't save changes.", "warn");
    }
  };

  const handleDelete = async (id: string) => {
    setDrawer(null);
    try {
      await apiFetch(`/api/task/${id}?room_id=${roomCode}`, { method: "DELETE" });
      toast("Task deleted");
    } catch {
      toast("Delete failed.", "error");
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, col: string) => {
    const id = event.dataTransfer.getData("taskId");
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task || task.column === col) return;
    handleSave({ ...task, column: col, updated_at: Date.now() });
    toast(`Moved to ${col}`);
  };

  const handleSendMessage = async (text: string) => {
    await apiFetch(`/api/chat/message`, {
        method: 'POST',
        body: JSON.stringify({ room_id: roomCode, sender: "You", message: text })
    });
  };

  const handleVoice = async () => {
    setVoiceLoading(true);
    try {
      const { job_id } = await apiFetch<{ job_id: string }>(`/api/voice/speak?room_id=${roomCode}`, {
        method: "POST",
      });

      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const job = await apiFetch<{ status: string; audio_url?: string }>(`/api/voice/${job_id}`);
          if (job.status === "completed" && job.audio_url) {
            clearInterval(poll);
            setVoiceLoading(false);
            new Audio(`${API_BASE}${job.audio_url}`).play();
            toast("Playing board summary");
          }
        } catch {
          // no-op
        }
        if (tries > 20) {
          clearInterval(poll);
          setVoiceLoading(false);
          toast("Voice timed out.", "warn");
        }
      }, 1500);
    } catch {
      setVoiceLoading(false);
      toast("Voice unavailable.", "warn");
    }
  };

  const colTasks = (col: string) => tasks.filter((task) => task.column === col);

  return (
    <div className="flex h-screen bg-[#08090a] overflow-hidden">
        <div className="flex-1 flex flex-col relative">
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.04] shrink-0">
                <h1 className="text-lg font-bold text-gray-200">Kanban Board ({roomCode})</h1>
                <button
                    onClick={handleVoice}
                    disabled={voiceLoading}
                    className="flex items-center gap-2 text-[13px] text-[#71717a] hover:text-white bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-xl px-4 py-2 transition-all disabled:opacity-50"
                >
                    Read update
                </button>
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-hidden p-5 flex gap-4 min-h-0 relative z-10">
                {COLUMNS.map((columnName) => (
                <Column
                    key={columnName}
                    col={columnName}
                    tasks={colTasks(columnName)}
                    onAdd={handleAdd}
                    onOpen={setDrawer}
                    onDrop={handleDrop}
                />
                ))}
            </div>

            {drawer && <TaskDrawer task={drawer} onClose={() => setDrawer(null)} onSave={handleSave} onDelete={handleDelete} />}
        </div>
        
        {/* Chat Drawer Container */}
        <div className={`fixed top-0 right-0 h-full w-80 z-50 transition-transform duration-300 ease-in-out ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className="absolute -left-10 top-1/2 -mt-5 p-2 bg-[#08090a] border border-white/[0.06] rounded-l-xl text-gray-400 hover:text-white"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isChatOpen ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
                </svg>
            </button>
            <div className="w-80 h-full border-l border-white/[0.04] bg-[#08090a]">
                {isChatOpen && <ChatWindow messages={chatMessages} onSendMessage={handleSendMessage} />}
            </div>
        </div>
    </div>
  );
}
