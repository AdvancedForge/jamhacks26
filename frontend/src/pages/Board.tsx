import { useCallback, useEffect, useState } from "react";
import type { DragEvent } from "react";
import { API_BASE, apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";
import { COLUMNS, Column, type CreateTaskInput, TaskDrawer } from "../components/BoardUI";

export default function BoardPage({
  roomCode,
  toast,
  onPoll,
}: {
  roomCode: string;
  toast: ToastFn;
  onPoll?: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drawer, setDrawer] = useState<Task | null>(null);
  const [retries, setRetries] = useState(0);
  const [voiceLoading, setVoiceLoading] = useState(false);

  const fetchBoard = useCallback(async () => {
    try {
      const data = await apiFetch<{ tasks?: Task[] }>(`/api/board/${roomCode}`);
      setTasks((data.tasks || []).filter((task) => !task.deleted));
      onPoll?.();
      setRetries(0);
    } catch {
      setRetries((retryCount) => retryCount + 1);
    }
  }, [onPoll, roomCode]);

  useEffect(() => {
    fetchBoard();
    const timer = setInterval(fetchBoard, 3000);
    return () => clearInterval(timer);
  }, [fetchBoard]);

  useEffect(() => {
    if (retries >= 15) toast("Lost connection. Showing stale data.", "error");
  }, [retries, toast]);

  const handleAdd = async ({ title, description, column }: CreateTaskInput) => {
    const now = Date.now();
    const optimistic: Task = {
      id: `t_${Math.random().toString(36).slice(2, 7)}`,
      title,
      description,
      column,
      assignee: "",
      created_at: now,
      updated_at: now,
    };
    setTasks((current) => [...current, optimistic]);

    try {
      await apiFetch(`/api/task/create?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ title, description, column, assignee: "", created_at: now }),
      });
      toast(`Task added to ${column}`);
      fetchBoard().catch(() => {});
    } catch {
      toast("Failed to save task.", "error");
    }
  };

  const handleSave = async (updated: Task) => {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
    if (drawer) setDrawer(updated);
    try {
      await apiFetch(`/api/task/${updated.id}?room_id=${roomCode}`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
    } catch {
      toast("Couldn't save changes.", "warn");
    }
  };

  const handleDelete = async (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
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

  const handleVoice = async () => {
    setVoiceLoading(true);
    try {
      const { job_id } = await apiFetch<{ job_id: string }>(`/api/voice/speak?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ tasks }),
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
    <div className="flex flex-col h-full bg-[#08090a] relative">
      <div className="absolute top-0 right-[20%] w-[500px] h-[400px] bg-[#3b82f6]/[0.04] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-[10%] w-[400px] h-[300px] bg-[#8b5cf6]/[0.03] rounded-full blur-[100px] pointer-events-none" />

      <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.04] shrink-0 relative z-10">
        <div className="flex items-center gap-5 text-[12px] text-[#52525b]">
          <span>{tasks.length} tasks</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
            <span className="text-[#71717a]">{colTasks("Done").length} done</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
            <span className="text-[#71717a]">{colTasks("In Progress").length} in progress</span>
          </span>
        </div>
        <button
          onClick={handleVoice}
          disabled={voiceLoading}
          className="flex items-center gap-2 text-[13px] text-[#71717a] hover:text-white bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-xl px-4 py-2 transition-all disabled:opacity-50"
        >
          {voiceLoading ? (
            <span className="w-3.5 h-3.5 border-2 border-[#71717a]/30 border-t-[#71717a] rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
              <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.061Z" />
            </svg>
          )}
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
  );
}
