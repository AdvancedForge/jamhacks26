import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { ChatMessage, Task, ToastFn } from "../hackbuddyTypes";
import { DndContext, closestCenter, DragOverlay } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { ChatWindow } from "../components/ChatWindow";
import { useBoardWebSocket } from "../hooks/useBoardWebSocket";

const COL_COLOR: Record<string, string> = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" };
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

function SortableTask({ id, task }: { id: string; task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center gap-2 mb-2 p-2 bg-white/5 rounded cursor-grab touch-none">
      <span className="w-3 h-3 rounded-full" style={{ background: COL_COLOR[task.column] || "#71717a" }} />
      <span className="flex-1">{task.title}</span>
      <span className="text-xs text-gray-500">{task.assignee || "Unassigned"}</span>
    </div>
  );
}

function PhaseContainer({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className="min-h-[50px]">{children}</div>;
}

export default function RoadmapPage({ roomCode, toast }: { roomCode: string; toast: ToastFn }) {
  const [roadmap, setRoadmap] = useState<{ vision: string; phases: Record<string, string[]> }>({ vision: "", phases: {} });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingVision, setIsEditingVision] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || FALLBACK_DEFAULT_CHAT_MODEL,
  );
  const [chatModelOptions, setChatModelOptions] = useState<ChatModelOption[]>(
    FALLBACK_CHAT_MODELS.map((modelName) => ({ value: modelName, label: formatModelLabel(modelName) })),
  );
  const [selectedVisionText, setSelectedVisionText] = useState("");
  const visionPreviewRef = useRef<HTMLDivElement>(null);

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

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch<{ roadmap: string; tasks: Task[] }>(`/api/board/${roomCode}`);
      let parsedRoadmap = { vision: "Add vision here...", phases: {} };
      if (data.roadmap) {
        try {
          const parsed = JSON.parse(data.roadmap);
          parsedRoadmap = {
            vision: parsed.vision || "Add vision here...",
            phases: parsed.phases || {},
          };
        } catch (error) {
          console.error("Failed to parse roadmap JSON, treating as raw text", error);
          parsedRoadmap = { vision: data.roadmap, phases: {} };
        }
      }
      setRoadmap(parsedRoadmap);
      setTasks(data.tasks || []);
      setLoading(false);
    } catch {
      toast("Failed to load roadmap.", "error");
    }
  }, [roomCode, toast]);

  const fetchChatModels = useCallback(async () => {
    try {
      const data = await apiFetch<{ models?: string[]; default_model?: string }>(`/api/chat/models`);
      const modelNames = (data.models || []).filter((modelName) => modelName.trim().length > 0);
      if (modelNames.length === 0) return;
      const options = modelNames.map((modelName) => ({ value: modelName, label: formatModelLabel(modelName) }));
      setChatModelOptions(options);
      setSelectedModel((currentModel) => {
        if (modelNames.includes(currentModel)) return currentModel;
        if (data.default_model && modelNames.includes(data.default_model)) return data.default_model;
        return modelNames[0];
      });
    } catch {
      // Keep fallback options.
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
      // Keep chat live-only if history cannot be loaded.
    }
  }, [roomCode, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

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

  useEffect(() => {
    if ((window as any).marked) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!isEditingVision && visionPreviewRef.current && (window as any).marked) {
      visionPreviewRef.current.innerHTML = (window as any).marked.parse(roadmap.vision);
    }
  }, [isEditingVision, roadmap.vision]);

  const saveRoadmap = async (nextRoadmap: typeof roadmap) => {
    setRoadmap(nextRoadmap);
    try {
      await apiFetch(`/api/roadmap/${roomCode}`, {
        method: "PUT",
        body: JSON.stringify({ roadmap: JSON.stringify(nextRoadmap) }),
      });
    } catch {
      toast("Failed to save roadmap.", "error");
    }
  };

  const addPhase = () => {
    const name = prompt("Enter phase name");
    if (name) saveRoadmap({ ...roadmap, phases: { ...roadmap.phases, [name]: [] } });
  };

  const removePhase = (phase: string) => {
    if (confirm(`Remove phase ${phase}?`)) {
      const nextPhases = { ...roadmap.phases };
      delete nextPhases[phase];
      saveRoadmap({ ...roadmap, phases: nextPhases });
    }
  };

  const onDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const onDragEnd = (event: any) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const draggedId = active.id;
    const overId = over.id;
    const activePhase = Object.keys(roadmap.phases).find((phase) => roadmap.phases[phase].includes(draggedId)) || "unassigned";
    const overPhase =
      Object.keys(roadmap.phases).find((phase) => roadmap.phases[phase].includes(overId)) || (overId in roadmap.phases ? overId : null);
    if (!overPhase) return;
    const nextRoadmap = { ...roadmap, phases: { ...roadmap.phases } };
    if (activePhase !== "unassigned") {
      nextRoadmap.phases[activePhase] = nextRoadmap.phases[activePhase].filter((taskId) => taskId !== draggedId);
    }
    if (overPhase !== "unassigned") {
      if (!nextRoadmap.phases[overPhase]) nextRoadmap.phases[overPhase] = [];
      const overIndex = nextRoadmap.phases[overPhase].indexOf(overId);
      if (overIndex !== -1) {
        nextRoadmap.phases[overPhase].splice(overIndex, 0, draggedId);
      } else {
        nextRoadmap.phases[overPhase].push(draggedId);
      }
    }
    saveRoadmap(nextRoadmap);
  };

  const handleVisionSelection = useCallback(() => {
    if (isEditingVision || !visionPreviewRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    if (!selectedText) return;
    const range = selection.getRangeAt(0);
    if (!visionPreviewRef.current.contains(range.commonAncestorContainer)) return;
    setSelectedVisionText(selectedText.slice(0, 1200));
    setIsChatOpen(true);
  }, [isEditingVision]);

  const clearSelectionContext = () => {
    setSelectedVisionText("");
    const selection = window.getSelection();
    selection?.removeAllRanges();
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
      sender: "You",
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
          sender: "You",
          message,
          client_nonce: clientNonce,
          model: selectedModel,
          ...(selectedVisionText ? { roadmap_selection: selectedVisionText } : {}),
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

  const sendBrainstormPrompt = (promptText: string) => {
    setIsChatOpen(true);
    void handleSendMessage(promptText);
  };

  return (
    <div data-tour="roadmap-workspace" className="p-6 h-full flex flex-col gap-6 relative overflow-hidden">
      <div className="flex justify-between items-center flex-none">
        <h2 className="text-xl font-bold">Roadmap</h2>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className={`flex gap-6 flex-1 min-h-0 transition-[padding] duration-300 ${isChatOpen ? "xl:pr-[22rem]" : ""}`}>
          <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
            <div className="lg:w-1/2 h-full min-h-[280px] bg-[#0a0b0d] border border-white/10 rounded-lg text-white p-4 flex flex-col">
              <div className="flex justify-between items-center mb-4 flex-none">
                <h3 className="font-bold">Project Vision (Markdown)</h3>
                <button
                  onClick={() => setIsEditingVision(!isEditingVision)}
                  className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition-all"
                >
                  {isEditingVision ? "Save" : "Edit"}
                </button>
              </div>
              {!isEditingVision && selectedVisionText && (
                <div className="mb-3 border border-blue-500/50 bg-blue-500/[0.08] rounded-lg p-3 text-[12px] text-[#dbeafe]">
                  <p className="font-medium">Selection ready for HackBuddy chat</p>
                  <p className="mt-1 max-h-16 overflow-y-auto text-[#bfdbfe]">{selectedVisionText}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => sendBrainstormPrompt("Can you help improve and refine this selected roadmap section?")}
                      className="px-2 py-1 rounded bg-white text-[#09090b] text-[11px] font-medium"
                    >
                      Discuss selection
                    </button>
                    <button
                      onClick={clearSelectionContext}
                      className="px-2 py-1 rounded border border-white/[0.2] text-[11px] text-white/80"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-hidden relative">
                {isEditingVision ? (
                  <textarea
                    className="w-full h-full bg-transparent outline-none resize-none overflow-y-auto"
                    value={roadmap.vision}
                    placeholder="Describe your project vision in detail using markdown..."
                    onChange={(event) => saveRoadmap({ ...roadmap, vision: event.target.value })}
                  />
                ) : (
                  <div
                    ref={visionPreviewRef}
                    onMouseUp={handleVisionSelection}
                    onKeyUp={handleVisionSelection}
                    onTouchEnd={handleVisionSelection}
                    className="prose prose-invert max-w-none h-full overflow-y-auto"
                  />
                )}
              </div>
            </div>

            <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              <div className="lg:w-1/2 h-full min-h-[280px] bg-[#0a0b0d] border border-white/10 rounded-lg text-white overflow-y-auto p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">Implementation Order</h3>
                  <button onClick={addPhase} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">+</button>
                </div>
                {Object.entries(roadmap.phases).map(([phase, taskIds]) => (
                  <div key={phase} className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-semibold text-gray-400">{phase}</h4>
                      <button onClick={() => removePhase(phase)} className="text-gray-500 hover:text-red-400">×</button>
                    </div>
                    <PhaseContainer id={phase}>
                      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                        {taskIds.map((id) => {
                          const task = tasks.find((item) => item.id === id);
                          if (!task) return null;
                          return <SortableTask key={id} id={id} task={task} />;
                        })}
                      </SortableContext>
                    </PhaseContainer>
                  </div>
                ))}
                <div className="mt-8">
                  <h4 className="font-semibold text-gray-400 mb-2">Unassigned</h4>
                  <PhaseContainer id="unassigned">
                    <SortableContext
                      items={tasks.filter((task) => !Object.values(roadmap.phases).flat().includes(task.id)).map((task) => task.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {tasks
                        .filter((task) => !Object.values(roadmap.phases).flat().includes(task.id))
                        .map((task) => (
                          <SortableTask key={task.id} id={task.id} task={task} />
                        ))}
                    </SortableContext>
                  </PhaseContainer>
                </div>
              </div>
              <DragOverlay>
                {activeId ? (
                  <div className="flex items-center gap-2 mb-2 p-2 bg-white/20 rounded cursor-grabbing border border-white/40 shadow-xl">
                    <span className="w-3 h-3 rounded-full" />
                    <span className="flex-1">{(tasks.find((task) => task.id === activeId) || { title: "Dragging..." }).title}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      )}

      <div
        className={`absolute top-0 right-0 h-full w-[22rem] max-w-[92vw] z-40 transition-transform duration-300 ease-in-out ${
          isChatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          onClick={() => setIsChatOpen((open) => !open)}
          data-tour="roadmap-ai-chat-toggle"
          className="absolute -left-10 top-1/2 -mt-5 p-2 bg-[#08090a] border border-white/[0.06] rounded-l-xl text-[#71717a] hover:text-white"
          aria-label={isChatOpen ? "Close roadmap AI sidebar" : "Open roadmap AI sidebar"}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isChatOpen ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
          </svg>
        </button>
        <div data-tour="roadmap-ai-chat-panel" className="w-full h-full bg-[#08090a] border-l border-white/[0.04] flex flex-col">
          <div className="border-b border-white/[0.06] px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#71717a]">HackBuddy roadmap assistant</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => sendBrainstormPrompt("Brainstorm three strong hackathon MVP ideas we can build this weekend.")}
                className="text-[11px] px-2 py-1 rounded border border-white/[0.1] bg-white/[0.03] text-[#d4d4d8] hover:text-white"
              >
                Idea kickoff
              </button>
              <button
                onClick={() => sendBrainstormPrompt("Given our roadmap, what should our first implementation milestone be?")}
                className="text-[11px] px-2 py-1 rounded border border-white/[0.1] bg-white/[0.03] text-[#d4d4d8] hover:text-white"
              >
                First milestone
              </button>
              <button
                onClick={() => sendBrainstormPrompt("How can we de-risk this roadmap for a hackathon demo deadline?")}
                className="text-[11px] px-2 py-1 rounded border border-white/[0.1] bg-white/[0.03] text-[#d4d4d8] hover:text-white"
              >
                De-risk plan
              </button>
            </div>
            {selectedVisionText && (
              <p className="mt-2 text-[11px] text-[#93c5fd]">
                Selected text context is attached to your roadmap chat messages.
              </p>
            )}
          </div>
          <div className="flex-1 min-h-0">
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
    </div>
  );
}