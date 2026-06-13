import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { API_BASE, apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn, ChatMessage } from "../hackbuddyTypes";
import { COLUMNS, Column, DragTaskCardPreview, type CreateTaskInput, TaskDrawer } from "../components/BoardUI";
import { ChatWindow } from "../components/ChatWindow";
import { useBoardWebSocket } from "../hooks/useBoardWebSocket";
const CHAT_MODEL_STORAGE_KEY = "hackpilot_chat_model";
const FALLBACK_CHAT_MODELS = ["gemma-4-31b-it", "gemini-2.5-flash", "gemini-2.5-pro"];
const FALLBACK_DEFAULT_CHAT_MODEL = FALLBACK_CHAT_MODELS[0];
const isClearChatCommand = (value: string) => {
  const command = value.trim().toLowerCase().split(/\s+/)[0];
  return command === "/clear" || command === "/clear-chat" || command === "/clearchat";
};

type ChatModelOption = {
  value: string;
  label: string;
};

const formatModelLabel = (modelName: string) =>
  modelName
    .split("-")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+(?:\.\d+)?$/.test(segment)) return segment;
      if (segment.length <= 3) return segment.toUpperCase();
      return segment[0].toUpperCase() + segment.slice(1);
    })
    .join(" ");

export default function BoardPage({
  roomCode,
  toast,
  onPoll,
  currentUserName,
}: {
  roomCode: string;
  toast: ToastFn;
  onPoll?: () => void;
  currentUserName?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || FALLBACK_DEFAULT_CHAT_MODEL,
  );
  const [chatModelOptions, setChatModelOptions] = useState<ChatModelOption[]>(
    FALLBACK_CHAT_MODELS.map((modelName) => ({
      value: modelName,
      label: formatModelLabel(modelName),
    })),
  );
  const [drawer, setDrawer] = useState<Task | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [retries, setRetries] = useState(0);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const preDragSnapshotRef = useRef<Task[] | null>(null);
  const dragActiveRef = useRef(false);
  const dragOverRafRef = useRef<number | null>(null);
  const pendingDragOverRef = useRef<{ activeId: string; overId: string; overColumn?: string } | null>(null);
  const lastDragOverSignatureRef = useRef<string | null>(null);
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
  const mergeChatMessages = useCallback((currentMessages: ChatMessage[], incomingMessages: ChatMessage[]) => {
    const nextMessages = [...currentMessages];
    for (const incoming of incomingMessages) {
      const existingIndex = nextMessages.findIndex((message) => {
        if (incoming.id && message.id === incoming.id) return true;
        if (incoming.client_nonce && message.client_nonce === incoming.client_nonce) return true;
        if (
          incoming.sender === message.sender &&
          incoming.message === message.message &&
          incoming.timestamp &&
          message.timestamp &&
          incoming.timestamp === message.timestamp
        ) {
          return true;
        }
        return false;
      });

      if (existingIndex === -1) {
        nextMessages.push(incoming);
        continue;
      }
      nextMessages[existingIndex] = { ...nextMessages[existingIndex], ...incoming };
    }

    return nextMessages.sort((left, right) => {
      const leftTime = left.timestamp || "";
      const rightTime = right.timestamp || "";
      return leftTime.localeCompare(rightTime);
    });
  }, []);
  const upsertChatMessage = useCallback((incoming: ChatMessage) => {
    setChatMessages((currentMessages) => mergeChatMessages(currentMessages, [incoming]));
  }, [mergeChatMessages]);

  const handleSocketMessage = useCallback((payload: unknown) => {
    const event = payload as { type?: string; message?: ChatMessage; status?: boolean };
    if (event.type === "CHAT_CLEARED") {
      setChatMessages([]);
      setIsAiThinking(false);
      toast("Chat cleared.");
      return;
    }
    if (event.type === "CHAT_MESSAGE" && event.message) {
      upsertChatMessage(event.message);
      return;
    }
    if (event.type === "CHAT_THINKING") {
      setIsAiThinking(Boolean(event.status));
    }
  }, [toast, upsertChatMessage]);

  useBoardWebSocket(roomCode, handleSocketMessage);
  useEffect(() => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  const fetchChatModels = useCallback(async () => {
    try {
      const data = await apiFetch<{ models?: string[]; default_model?: string }>(`/api/chat/models`);
      const modelNames = (data.models || []).filter((modelName) => modelName.trim().length > 0);
      if (modelNames.length === 0) return;
      const options = modelNames.map((modelName) => ({
        value: modelName,
        label: formatModelLabel(modelName),
      }));
      setChatModelOptions(options);
      setSelectedModel((currentModel) => {
        if (modelNames.includes(currentModel)) return currentModel;
        if (data.default_model && modelNames.includes(data.default_model)) return data.default_model;
        return modelNames[0];
      });
    } catch {
      // Fallback to static models.
    }
  }, []);

  const fetchChatHistory = useCallback(async () => {
    try {
      const data = await apiFetch<{ messages?: ChatMessage[]; saved?: boolean }>(`/api/chat/messages/${roomCode}`);
      const incomingMessages = (data.messages || []).map((message) => ({ ...message, is_streaming: false }));
      setChatMessages(incomingMessages);
      setIsAiThinking(false);
      if (data.saved === false) {
        toast("Chat history could not be loaded from MongoDB.", "warn");
      }
    } catch {
      // Keep chat live-only if history is unavailable.
    }
  }, [roomCode, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchChatModels().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchChatModels]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchChatHistory().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchChatHistory]);

  const fetchMembers = useCallback(async () => {
    try {
      const data = await apiFetch<{ members?: Array<{ name?: string }> }>(
        `/api/profile/members/${roomCode}`,
      );
      const names = (data.members || [])
        .map((member) => (member?.name || "").trim())
        .filter((name): name is string => Boolean(name));
      setMemberNames(Array.from(new Set(names)));
    } catch {
      // no-op
    }
  }, [roomCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchMembers().catch(() => {});
    }, 0);
    const interval = window.setInterval(() => {
      fetchMembers().catch(() => {});
    }, 5000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [fetchMembers]);


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
      setRetries((retryCount) => retryCount + 1);
    }
  }, [mergeServerTasks, onPoll, roomCode]);

  useEffect(() => {
    fetchBoard();
    const timer = setInterval(fetchBoard, 3000);
    return () => clearInterval(timer);
  }, [fetchBoard]);

  useEffect(() => {
    if (retries >= 15) toast("Lost connection. Showing stale data.", "error");
  }, [retries, toast]);

  const handleAdd = async ({ title, description, column, assignee }: CreateTaskInput) => {
    const now = Date.now();
    const optimistic: Task = {
      id: `t_${Math.random().toString(36).slice(2, 7)}`,
      title,
      description,
      column,
      assignee: assignee?.trim() || "",
      created_at: now,
      updated_at: now,
    };
    setTasks((current) => [...current, optimistic]);
    try {
      await apiFetch(`/api/task/create?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ title, description, column, assignee: assignee?.trim() || "", created_at: now }),
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
  const moveTaskPreview = useCallback(
    (currentTasks: Task[], activeId: string, overId: string, overColumn?: string) => {
      const hasSameLayout = (nextTasks: Task[]) =>
        nextTasks.length === currentTasks.length &&
        nextTasks.every((task, index) => task.id === currentTasks[index]?.id && task.column === currentTasks[index]?.column);
      const activeIndex = currentTasks.findIndex((task) => task.id === activeId);
      if (activeIndex === -1) return currentTasks;
      if (activeId === overId) return currentTasks;

      const overTask = currentTasks.find((task) => task.id === overId);
      const targetColumn = overTask?.column || overColumn;
      if (!targetColumn) return currentTasks;

      const nextTasks = [...currentTasks];
      const [removed] = nextTasks.splice(activeIndex, 1);
      const movedTask: Task = { ...removed, column: targetColumn };
      const overIsColumn = overId.startsWith("column:");

      if (overTask) {
        const targetIndex = nextTasks.findIndex((task) => task.id === overTask.id);
        if (targetIndex === -1) {
          nextTasks.push(movedTask);
        } else {
          nextTasks.splice(targetIndex, 0, movedTask);
        }
        if (hasSameLayout(nextTasks)) return currentTasks;
        return nextTasks;
      }

      if (overIsColumn && removed.column === targetColumn) {
        return currentTasks;
      }

      const targetColumnOrder = COLUMNS.indexOf(targetColumn as (typeof COLUMNS)[number]);
      if (targetColumnOrder === -1) return currentTasks;
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
      if (hasSameLayout(nextTasks)) return currentTasks;
      return nextTasks;
    },
    [],
  );

  const cancelPendingDragPreview = useCallback(() => {
    if (dragOverRafRef.current !== null) {
      cancelAnimationFrame(dragOverRafRef.current);
      dragOverRafRef.current = null;
    }
    pendingDragOverRef.current = null;
    lastDragOverSignatureRef.current = null;
  }, []);

  const flushPendingDragOver = useCallback(() => {
    dragOverRafRef.current = null;
    const pending = pendingDragOverRef.current;
    if (!pending) return;
    setTasks((currentTasks) => moveTaskPreview(currentTasks, pending.activeId, pending.overId, pending.overColumn));
  }, [moveTaskPreview]);

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (!tasks.some((task) => task.id === activeId)) return;
    cancelPendingDragPreview();
    dragActiveRef.current = true;
    preDragSnapshotRef.current = tasks;
    setActiveTaskId(activeId);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!event.over || !dragActiveRef.current) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const overColumn = typeof event.over.data.current?.column === "string" ? event.over.data.current.column : undefined;
    const signature = `${activeId}|${overId}|${overColumn || ""}`;
    if (lastDragOverSignatureRef.current === signature) return;
    lastDragOverSignatureRef.current = signature;
    pendingDragOverRef.current = { activeId, overId, overColumn };

    if (dragOverRafRef.current !== null) return;
    dragOverRafRef.current = requestAnimationFrame(flushPendingDragOver);
  };

  const resetDragState = () => {
    cancelPendingDragPreview();
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
    cancelPendingDragPreview();
    if (!event.over) {
      if (beforeDrag) setTasks(beforeDrag);
      resetDragState();
      return;
    }

    const overId = String(event.over.id);
    const overColumn = typeof event.over.data.current?.column === "string" ? event.over.data.current.column : undefined;
    const settledTasks = moveTaskPreview(tasks, activeId, overId, overColumn);
    if (settledTasks !== tasks) {
      setTasks(settledTasks);
    }
    const oldTask = beforeDrag?.find((task) => task.id === activeId);
    const newTask = settledTasks.find((task) => task.id === activeId);

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
    const message = text.trim();
    if (!message) return;
    if (isClearChatCommand(message)) {
      try {
        const response = await apiFetch<{ ok?: boolean; saved?: boolean }>(
          `/api/chat/clear?room_id=${encodeURIComponent(roomCode)}&sender=${encodeURIComponent("You")}`,
          { method: "POST" },
        );
        setChatMessages([]);
        setIsAiThinking(false);
        if (response.ok === false) toast("Failed to clear chat.", "warn");
      } catch {
        toast("Failed to clear chat.", "warn");
      }
      return;
    }
    const clientNonce = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    upsertChatMessage({
      sender: currentUserName?.trim() || "You",
      message,
      timestamp: new Date().toISOString(),
      client_nonce: clientNonce,
    });
    try {
      const response = await apiFetch<{ ok?: boolean; saved?: boolean }>(`/api/chat/message`, {
        method: "POST",
        headers: { "X-Gemini-Model": selectedModel },
        body: JSON.stringify({
          room_id: roomCode,
          sender: currentUserName?.trim() || "You",
          message,
          client_nonce: clientNonce,
          model: selectedModel,
        }),
      });
      if (response.ok === false || response.saved === false) {
        toast("Chat was queued locally; backend did not persist it.", "warn");
      }
    } catch {
      setChatMessages((currentMessages) => currentMessages.filter((entry) => entry.client_nonce !== clientNonce));
      setIsAiThinking(false);
      toast("Failed to send chat message.", "warn");
    }
  };
  useEffect(() => {
    return () => {
      cancelPendingDragPreview();
    };
  }, [cancelPendingDragPreview]);


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
  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find((task) => task.id === activeTaskId) || preDragSnapshotRef.current?.find((task) => task.id === activeTaskId) || null;
  }, [activeTaskId, tasks]);

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
              memberNames={memberNames}
              onAdd={handleAdd}
              onOpen={setDrawer}
              activeTaskId={activeTaskId}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <DragTaskCardPreview task={activeTask} /> : null}</DragOverlay>
      </DndContext>
      {drawer && (
        <TaskDrawer
          task={drawer}
          memberNames={memberNames}
          onClose={() => setDrawer(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      <div
        className={`absolute top-0 right-0 h-full w-80 z-40 transition-transform duration-300 ease-in-out ${
          isChatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          onClick={() => setIsChatOpen((open) => !open)}
          className="absolute -left-10 top-1/2 -mt-5 p-2 bg-[#08090a] border border-white/[0.06] rounded-l-xl text-[#71717a] hover:text-white"
          aria-label={isChatOpen ? "Close chat sidebar" : "Open chat sidebar"}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isChatOpen ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
          </svg>
        </button>
        <div className="w-80 h-full bg-[#08090a] border-l border-white/[0.04]">
          <ChatWindow
            roomCode={roomCode}
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            isAiThinking={isAiThinking}
            selectedModel={selectedModel}
            modelOptions={chatModelOptions}
            onSelectModel={setSelectedModel}
          />
        </div>
      </div>
    </div>
  );
}
