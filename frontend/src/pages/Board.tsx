import { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import type { DragEvent } from "react";
import { API_BASE, apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";
import { RoomContext } from '../context/RoomContext';
import { useBoardWebSocket } from '../hooks/useBoardWebSocket';
import { ChatWindow } from '../components/ChatWindow';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { COLUMNS, Column, DragTaskCardPreview, type CreateTaskInput, TaskDrawer } from "../components/BoardUI";

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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const preDragSnapshotRef = useRef<Task[] | null>(null);
  const dragActiveRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  }, []);

  const mergeServerTasks = useCallback((currentTasks: Task[], incomingTasks: Task[]) => {
    const consumed = new Set<string>();
    const incomingById = new Map(incomingTasks.map((task) => [task.id, task]));
    const merged: Task[] = [];

    for (const columnName of COLUMNS) {
      const currentColumnIds = currentTasks.filter((task) => task.column === columnName).map((task) => task.id);

      for (const id of currentColumnIds) {
        const fresh = incomingById.get(id);
        if (!fresh || fresh.column !== columnName || consumed.has(id)) continue;
        merged.push(fresh);
        consumed.add(id);
      }

      for (const fresh of incomingTasks) {
        if (fresh.column !== columnName || consumed.has(fresh.id)) continue;
        merged.push(fresh);
        consumed.add(fresh.id);
      }
    }

    for (const fresh of incomingTasks) {
      if (consumed.has(fresh.id)) continue;
      merged.push(fresh);
      consumed.add(fresh.id);
    }

    return merged;
  }, []);

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
      const incomingTasks = (data.tasks || []).filter((task) => !task.deleted);
      setTasks((currentTasks) => {
        if (dragActiveRef.current) return currentTasks;
        if (currentTasks.length === 0) return incomingTasks;
        return mergeServerTasks(currentTasks, incomingTasks);
      });
      onPoll?.();
      setRetries(0);
    } catch {
      toast("Failed to load board.", "error");
    }
  }, [mergeServerTasks, onPoll, roomCode]);

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
  const moveTaskPreview = useCallback(
    (currentTasks: Task[], activeId: string, overId: string, overColumn?: string) => {
      const activeIndex = currentTasks.findIndex((task) => task.id === activeId);
      if (activeIndex === -1) return currentTasks;
      if (activeId === overId) return currentTasks;

      const overTask = currentTasks.find((task) => task.id === overId);
      const targetColumn = overTask?.column || overColumn;
      if (!targetColumn) return currentTasks;

      const nextTasks = [...currentTasks];
      const [removed] = nextTasks.splice(activeIndex, 1);
      const movedTask: Task = { ...removed, column: targetColumn };

      if (overTask) {
        const targetIndex = nextTasks.findIndex((task) => task.id === overTask.id);
        if (targetIndex === -1) {
          nextTasks.push(movedTask);
        } else {
          nextTasks.splice(targetIndex, 0, movedTask);
        }
        return nextTasks;
      }

      const targetColumnOrder = COLUMNS.indexOf(targetColumn as (typeof COLUMNS)[number]);
      let insertIndex = nextTasks.length;
      for (let i = 0; i < nextTasks.length; i++) {
        const rowColumnOrder = COLUMNS.indexOf(nextTasks[i].column as (typeof COLUMNS)[number]);
        if (rowColumnOrder > targetColumnOrder) {
          insertIndex = i;
          break;
        }
        if (rowColumnOrder === targetColumnOrder) {
          insertIndex = i + 1;
        }
      }

      nextTasks.splice(insertIndex, 0, movedTask);
      const isSameLayout =
        nextTasks.length === currentTasks.length &&
        nextTasks.every((task, index) => task.id === currentTasks[index]?.id && task.column === currentTasks[index]?.column);
      if (isSameLayout) return currentTasks;
      return nextTasks;
    },
    [],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (!tasks.some((task) => task.id === activeId)) return;
    dragActiveRef.current = true;
    preDragSnapshotRef.current = tasks;
    setActiveTaskId(activeId);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const overColumn = typeof event.over.data.current?.column === "string" ? event.over.data.current.column : undefined;
    setTasks((currentTasks) => moveTaskPreview(currentTasks, activeId, overId, overColumn));
  };

  const resetDragState = () => {
    dragActiveRef.current = false;
    setActiveTaskId(null);
    preDragSnapshotRef.current = null;
  };

  const handleDragCancel = () => {
    if (preDragSnapshotRef.current) {
      setTasks(preDragSnapshotRef.current);
    }
    resetDragState();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const beforeDrag = preDragSnapshotRef.current;
    if (!event.over) {
      if (beforeDrag) setTasks(beforeDrag);
      resetDragState();
      return;
    }
    const oldTask = beforeDrag?.find((task) => task.id === activeId);
    const newTask = tasks.find((task) => task.id === activeId);

    if (!oldTask || !newTask) {
      resetDragState();
      return;
    }

    if (oldTask.column !== newTask.column) {
      const updated = { ...newTask, updated_at: Date.now() };
      void handleSave(updated);
      toast(`Moved to ${newTask.column}`);
    }

    resetDragState();
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
  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find((task) => task.id === activeTaskId) || preDragSnapshotRef.current?.find((task) => task.id === activeTaskId) || null;
  }, [activeTaskId, tasks]);

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

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-5 flex gap-4 min-h-0 relative z-10">
          {COLUMNS.map((columnName) => (
            <Column
              key={columnName}
              col={columnName}
              tasks={colTasks(columnName)}
              onAdd={handleAdd}
              onOpen={setDrawer}
              activeTaskId={activeTaskId}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <DragTaskCardPreview task={activeTask} /> : null}</DragOverlay>
      </DndContext>

      {drawer && <TaskDrawer task={drawer} onClose={() => setDrawer(null)} onSave={handleSave} onDelete={handleDelete} />}
    </div>
  );
}
