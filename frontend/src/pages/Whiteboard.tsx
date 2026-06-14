import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { WS_BASE, apiFetch } from "../hackbuddyApi";
import type { ToastFn, ChatMessage } from "../hackbuddyTypes";
import { useBoardWebSocket } from '../hooks/useBoardWebSocket';
import { ChatWindow } from '../components/ChatWindow';
import { AI_CONFIG_UPDATED_EVENT, DEFAULT_CHAT_MODELS, getAiHeaders } from "../aiConfig";
const CHAT_MODEL_STORAGE_KEY = "hackpilot_chat_model";
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
export default function WhiteboardPage({
  roomCode,
  toast,
  tourForceChatOpen = false,
}: {
  roomCode: string;
  toast: ToastFn;
  tourForceChatOpen?: boolean;
}) {
  type SceneElement = Record<string, unknown>;
  type SceneFiles = Record<string, unknown>;
  type SceneState = { elements: SceneElement[]; files: SceneFiles };

  const [framework] = useState<string>("react");
  const [, setStatus] = useState<string>("idle");
  const [, setCode] = useState<string>("");
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [, setSyncState] = useState<"connecting" | "live" | "offline">("connecting");
  const [, setLastSyncedAt] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || DEFAULT_CHAT_MODELS[0]);
  const [chatModelOptions, setChatModelOptions] = useState<ChatModelOption[]>(
    DEFAULT_CHAT_MODELS.map((modelName) => ({
      value: modelName,
      label: formatModelLabel(modelName),
    })),
  );

  const applyingRemoteRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSceneSignatureRef = useRef("");
  const lastServerUpdateRef = useRef(0);
  const lastSceneVersionRef = useRef(0);
  const fetchRequestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const hasLoadedInitialSceneRef = useRef(false);
  const actorIdRef = useRef(`wb_${Math.random().toString(36).slice(2, 10)}`);
  const chatSendInFlightRef = useRef(false);

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

  const handleMessage = useCallback((payload: unknown) => {
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
  useBoardWebSocket(roomCode, handleMessage);

  useEffect(() => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);
  useEffect(() => {
    if (!tourForceChatOpen) return;
    setIsChatOpen(true);
  }, [tourForceChatOpen]);
  const blobToDataUrl = useCallback((blob: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Failed to convert blob to data URL"));
      };
      reader.onerror = () => reject(new Error("Failed to read exported image blob"));
      reader.readAsDataURL(blob);
    });
  }, []);

  const exportCurrentWhiteboardImage = useCallback(async (): Promise<string | null> => {
    if (!excalidrawAPI) return null;
    const elements = excalidrawAPI.getSceneElements();
    if (!elements.length) return null;
    try {
      const blob = await exportToBlob({
        elements,
        appState: { background: "#ffffff" },
        files: excalidrawAPI.getFiles(),
      });
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }, [blobToDataUrl, excalidrawAPI]);

  const fetchChatModels = useCallback(async () => {
    try {
      const data = await apiFetch<{ models?: string[]; default_model?: string }>(
        `/api/chat/models?room_id=${encodeURIComponent(roomCode)}`,
        {
          headers: getAiHeaders(),
        },
      );
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
      // Fallback to static model list.
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
    const timer = window.setTimeout(() => {
      fetchChatModels().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchChatModels]);
  useEffect(() => {
    const handleAiConfigUpdated = () => {
      fetchChatModels().catch(() => {});
    };
    window.addEventListener(AI_CONFIG_UPDATED_EVENT, handleAiConfigUpdated);
    return () => window.removeEventListener(AI_CONFIG_UPDATED_EVENT, handleAiConfigUpdated);
  }, [fetchChatModels]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchChatHistory().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchChatHistory]);
  
  const handleSendMessage = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    if (isAiThinking || chatSendInFlightRef.current) {
      toast("Only one AI message at a time — wait for the current response to finish.", "warn");
      return;
    }
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
    chatSendInFlightRef.current = true;
    try {
      const whiteboardImage = await exportCurrentWhiteboardImage();
      const response = await apiFetch<{ ok?: boolean; saved?: boolean }>(`/api/chat/message`, {
        method: "POST",
        headers: { "X-Gemini-Model": selectedModel, ...getAiHeaders() },
        body: JSON.stringify({
          room_id: roomCode,
          sender: "You",
          message,
          client_nonce: clientNonce,
          model: selectedModel,
          ...(whiteboardImage ? { whiteboard_image_base64: whiteboardImage } : {}),
        }),
      });
      if (response.ok === false || response.saved === false) {
        toast("Chat was queued locally; backend did not persist it.", "warn");
      }
    } catch (error) {
      setChatMessages((currentMessages) => currentMessages.filter((entry) => entry.client_nonce !== clientNonce));
      setIsAiThinking(false);
      const messageText = error instanceof Error ? error.message : "";
      if (messageText) {
        toast(messageText, "warn");
      } else {
        toast("Failed to send chat message.", "warn");
      }
    } finally {
      chatSendInFlightRef.current = false;
    }
  };

  const asSceneElement = useCallback((value: unknown): SceneElement | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as SceneElement;
  }, []);

  const normalizeScene = useCallback(
    (scene: unknown): SceneState => {
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
        return { elements: [], files: {} };
      }
      const rawScene = scene as Record<string, unknown>;
      const rawElements = Array.isArray(rawScene.elements) ? rawScene.elements : [];
      const elements = rawElements.map(asSceneElement).filter((element): element is SceneElement => element !== null);
      const files =
        rawScene.files && typeof rawScene.files === "object" && !Array.isArray(rawScene.files)
          ? { ...(rawScene.files as SceneFiles) }
          : {};
      return { elements, files };
    },
    [asSceneElement],
  );

  const elementId = useCallback((element: SceneElement) => {
    const id = element.id;
    return typeof id === "string" ? id : "";
  }, []);

  const elementNumber = useCallback((element: SceneElement, key: string) => {
    const value = element[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }, []);

  const chooseNewerElement = useCallback(
    (left: SceneElement, right: SceneElement) => {
      const leftVersion = elementNumber(left, "version");
      const rightVersion = elementNumber(right, "version");
      if (rightVersion !== leftVersion) return rightVersion > leftVersion ? right : left;

      const leftUpdated = elementNumber(left, "updated");
      const rightUpdated = elementNumber(right, "updated");
      if (rightUpdated !== leftUpdated) return rightUpdated > leftUpdated ? right : left;

      const leftNonce = elementNumber(left, "versionNonce");
      const rightNonce = elementNumber(right, "versionNonce");
      if (rightNonce !== leftNonce) return rightNonce > leftNonce ? right : left;

      const leftDeleted = Boolean(left.isDeleted);
      const rightDeleted = Boolean(right.isDeleted);
      if (rightDeleted !== leftDeleted) return rightDeleted ? right : left;

      return right;
    },
    [elementNumber],
  );

  const mergeScenes = useCallback(
    (baseScene: unknown, incomingScene: unknown): SceneState => {
      const base = normalizeScene(baseScene);
      const incoming = normalizeScene(incomingScene);

      const winners = new Map<string, SceneElement>();
      const baseById = new Map<string, SceneElement>();
      const incomingOrder: string[] = [];
      const baseOrder: string[] = [];

      for (const element of base.elements) {
        const id = elementId(element);
        if (!id) continue;
        baseById.set(id, element);
        baseOrder.push(id);
      }

      for (const element of incoming.elements) {
        const id = elementId(element);
        if (!id) continue;
        incomingOrder.push(id);
        const existing = baseById.get(id);
        winners.set(id, existing ? chooseNewerElement(existing, element) : element);
      }

      for (const [id, element] of baseById.entries()) {
        if (!winners.has(id)) winners.set(id, element);
      }

      const mergedElements: SceneElement[] = [];
      const emitted = new Set<string>();
      for (const id of [...incomingOrder, ...baseOrder]) {
        if (emitted.has(id)) continue;
        const winner = winners.get(id);
        if (!winner) continue;
        mergedElements.push(winner);
        emitted.add(id);
      }
      for (const [id, winner] of winners.entries()) {
        if (emitted.has(id)) continue;
        mergedElements.push(winner);
        emitted.add(id);
      }

      return { elements: mergedElements, files: { ...base.files, ...incoming.files } };
    },
    [chooseNewerElement, elementId, normalizeScene],
  );

  const sceneSignature = useCallback(
    (scene: SceneState) => {
      const elementPart = scene.elements
        .map((element) => {
          return `${elementId(element)}:${elementNumber(element, "version")}:${elementNumber(element, "updated")}:${elementNumber(element, "versionNonce")}:${Boolean(element.isDeleted) ? 1 : 0}`;
        })
        .join("|");
      const filePart = Object.keys(scene.files).sort().join(",");
      return `${elementPart}::${filePart}`;
    },
    [elementId, elementNumber],
  );

  const getLocalScene = useCallback((): SceneState => {
    if (!excalidrawAPI) return { elements: [], files: {} };
    const elements =
      typeof excalidrawAPI.getSceneElementsIncludingDeleted === "function"
        ? excalidrawAPI.getSceneElementsIncludingDeleted()
        : typeof excalidrawAPI.getSceneElements === "function"
          ? excalidrawAPI.getSceneElements()
          : [];
    const files = typeof excalidrawAPI.getFiles === "function" ? excalidrawAPI.getFiles() : {};
    return normalizeScene({ elements, files });
  }, [excalidrawAPI, normalizeScene]);

  const applyRemoteScene = useCallback(
    (remoteScene: unknown) => {
      if (!excalidrawAPI) return;
      const mergedScene = mergeScenes(getLocalScene(), remoteScene);
      const signature = sceneSignature(mergedScene);
      if (signature === lastSceneSignatureRef.current) return;

      applyingRemoteRef.current = true;
      excalidrawAPI.updateScene(mergedScene);
      lastSceneSignatureRef.current = signature;
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 0);
    },
    [excalidrawAPI, getLocalScene, mergeScenes, sceneSignature],
  );

  const fetchSharedScene = useCallback(async () => {
    if (!roomCode) return;
    const requestId = ++fetchRequestIdRef.current;
    try {
      const data = await apiFetch<{ scene?: unknown; updated_at?: number; scene_version?: number }>(
        `/api/whiteboard/scene/${roomCode}`,
      );
      if (requestId !== fetchRequestIdRef.current) return;

      const sceneVersion = Number(data?.scene_version || 0);
      const updatedAt = Number(data?.updated_at || 0);
      const shouldApply =
        !lastSceneSignatureRef.current ||
        sceneVersion > lastSceneVersionRef.current ||
        updatedAt > lastServerUpdateRef.current;

      lastSceneVersionRef.current = Math.max(lastSceneVersionRef.current, sceneVersion);
      lastServerUpdateRef.current = Math.max(lastServerUpdateRef.current, updatedAt);
      hasLoadedInitialSceneRef.current = true;

      if (shouldApply) applyRemoteScene(data?.scene);

      setSyncState("live");
      setLastSyncedAt(Date.now());
    } catch {
      if (requestId === fetchRequestIdRef.current) {
        hasLoadedInitialSceneRef.current = true;
        setSyncState("offline");
      }
    }
  }, [applyRemoteScene, roomCode]);

  const pushSharedScene = useCallback(
    async (elements: readonly unknown[], files: unknown, retryCount = 0) => {
      const localScene = normalizeScene({ elements, files });
      const signature = sceneSignature(localScene);
      if (signature === lastSceneSignatureRef.current) return;

      const requestId = ++saveRequestIdRef.current;
      try {
        const data = await apiFetch<{ scene?: unknown; updated_at?: number; scene_version?: number }>(
          `/api/whiteboard/scene/${roomCode}`,
          {
            method: "PUT",
            body: JSON.stringify({
              scene: localScene,
              base_version: lastSceneVersionRef.current,
              actor_id: actorIdRef.current,
            }),
          },
        );
        if (requestId !== saveRequestIdRef.current) return;

        const sceneVersion = Number(data?.scene_version || 0);
        const updatedAt = Number(data?.updated_at || Date.now());
        lastSceneVersionRef.current = Math.max(lastSceneVersionRef.current, sceneVersion);
        lastServerUpdateRef.current = Math.max(lastServerUpdateRef.current, updatedAt);
        lastSceneSignatureRef.current = signature;

        if (data?.scene) applyRemoteScene(data.scene);

        setSyncState("live");
        setLastSyncedAt(Date.now());
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) return;

        const message = error instanceof Error ? error.message : "";
        const isConflict = message.startsWith("409") || message.includes("409");
        if (isConflict && retryCount < 2) {
          await fetchSharedScene();
          const latestLocalScene = getLocalScene();
          const latestSignature = sceneSignature(latestLocalScene);
          if (latestSignature !== lastSceneSignatureRef.current) {
            window.setTimeout(() => {
              pushSharedScene(
                latestLocalScene.elements,
                latestLocalScene.files,
                retryCount + 1,
              );
            }, 180);
          }
          return;
        }

        setSyncState("offline");
      }
    },
    [
      applyRemoteScene,
      fetchSharedScene,
      getLocalScene,
      normalizeScene,
      roomCode,
      sceneSignature,
    ],
  );

  const queueSceneSave = useCallback(
    (elements: readonly unknown[], files: unknown) => {
      if (!hasLoadedInitialSceneRef.current) return;
      if (applyingRemoteRef.current) return;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        pushSharedScene(elements, files);
      }, 350);
    },
    [pushSharedScene],
  );

  useEffect(() => {
    hasLoadedInitialSceneRef.current = false;
    lastSceneSignatureRef.current = "";
    lastServerUpdateRef.current = 0;
    lastSceneVersionRef.current = 0;
    fetchRequestIdRef.current = 0;
    saveRequestIdRef.current = 0;
    setSyncState("connecting");
    setLastSyncedAt(null);
  }, [roomCode]);

  useEffect(() => {
    if (!excalidrawAPI) return;
    fetchSharedScene();
    const poll = window.setInterval(fetchSharedScene, 2500);
    return () => window.clearInterval(poll);
  }, [excalidrawAPI, fetchSharedScene]);
  useEffect(() => {
    if (!roomCode) return;

    const ws = new WebSocket(`${WS_BASE}/ws/board/${roomCode}`);
    const pingInterval = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25000);

    ws.onopen = () => setSyncState("live");
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        if (message?.type !== "WHITEBOARD_UPDATED") return;

        const messageActorId = typeof message.actor_id === "string" ? message.actor_id : "";
        const messageVersion = Number(message.scene_version || 0);
        const messageUpdatedAt = Number(message.updated_at || 0);
        const knownVersion = lastSceneVersionRef.current;
        const knownUpdatedAt = lastServerUpdateRef.current;

        if (messageActorId && messageActorId === actorIdRef.current) {
          lastSceneVersionRef.current = Math.max(knownVersion, messageVersion);
          lastServerUpdateRef.current = Math.max(knownUpdatedAt, messageUpdatedAt);
          return;
        }
        if (messageVersion <= knownVersion && messageUpdatedAt <= knownUpdatedAt) return;
        fetchSharedScene();
      } catch {
        // ignore non-json socket traffic
      }
    };
    ws.onerror = () => setSyncState("offline");
    ws.onclose = () => {
      setSyncState((prev) => (prev === "offline" ? prev : "connecting"));
    };

    return () => {
      window.clearInterval(pingInterval);
      ws.close();
    };
  }, [fetchSharedScene, roomCode]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleGenerate = async () => {
    if (!excalidrawAPI) {
      toast("Canvas not ready.", "warn");
      return;
    }
    const elements = excalidrawAPI.getSceneElements();
    if (!elements.length) {
      toast("Draw something first.", "warn");
      return;
    }

    setStatus("loading");
    setCode("");
    const imageDataUrl = await exportCurrentWhiteboardImage();
    if (!imageDataUrl) {
      setStatus("error");
      toast("Export failed.", "error");
      return;
    }

    try {
      const { job_id } = await apiFetch<{ job_id: string }>(`/api/whiteboard/generate?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ image_base64: imageDataUrl, framework }),
      });

      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const job = await apiFetch<{ status: string; code?: string }>(`/api/whiteboard/${job_id}`);
          if (job.status === "completed") {
            clearInterval(poll);
            setCode(job.code || "");
            setStatus("done");
            if (job.code) {
              upsertChatMessage({
                sender: "AI Whiteboard Assistant",
                message: `Generated ${framework} boilerplate from your sketch:\n\n${job.code}`,
                timestamp: new Date().toISOString(),
              });
            }
            toast("Code generated");
          } else if (job.status === "error") {
            clearInterval(poll);
            setStatus("error");
            toast("Generation failed.", "error");
          }
        } catch {
          // no-op
        }
        if (tries > 30) {
          clearInterval(poll);
          setStatus("error");
          toast("Timed out.", "warn");
        }
      }, 1500);
    } catch {
      setStatus("error");
      toast("Backend unreachable.", "error");
    }
  };

  const handleFeedback = async () => {
    if (!excalidrawAPI) { toast("Canvas not ready.", "warn"); return; }
    const elements = excalidrawAPI.getSceneElements();
    if (!elements.length) { toast("Draw something first.", "warn"); return; }
    toast("Analyzing sketch...", "info");
    const imageDataUrl = await exportCurrentWhiteboardImage();
    if (!imageDataUrl) { toast("Analysis export failed.", "error"); return; }
    try {
        await apiFetch(`/api/whiteboard/analyze?room_id=${encodeURIComponent(roomCode)}`, {
          method: "POST",
          body: JSON.stringify({ image_base64: imageDataUrl }),
        });
        toast("Feedback sent to chat!");
    } catch { toast("Analysis failed.", "error"); }
  }

  return (
    <div className="flex h-screen bg-[#08090a] overflow-hidden relative">
        <div data-tour="whiteboard-canvas" className="flex-1 relative">
            <Excalidraw
                theme="dark"
                excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
                UIOptions={{
                    canvasActions: {
                        loadScene: false,
                        saveToActiveFile: false,
                        export: false,
                    },
                }}
                onChange={(elements: readonly unknown[], _appState: unknown, files: unknown) => {
                    queueSceneSave(elements, files || {});
                }}
            />
            {/* Minimal controls overlay */}
            <div data-tour="whiteboard-ai-tools" className="absolute top-4 left-4 flex gap-2">
                <button onClick={handleGenerate} className="bg-white text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200">Generate Code</button>
                <button onClick={handleFeedback} className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-700">🤖 AI Feedback</button>
            </div>
        </div>

        {/* Chat Drawer Container */}
        <div className={`fixed top-0 right-0 h-full w-80 z-50 transition-transform duration-300 ease-in-out ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                data-tour="whiteboard-ai-chat-toggle"
                className="absolute -left-10 top-1/2 -mt-5 p-2 bg-[#08090a] border border-white/[0.06] rounded-l-xl text-gray-400 hover:text-white"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isChatOpen ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
                </svg>
            </button>
            <div data-tour="whiteboard-ai-chat-panel" className="w-80 h-full border-l border-white/[0.04] bg-[#08090a]">
                {isChatOpen && (
                  <ChatWindow
                    roomCode={roomCode}
                    messages={chatMessages}
                    onSendMessage={handleSendMessage}
                    isAiThinking={isAiThinking}
                    selectedModel={selectedModel}
                    modelOptions={chatModelOptions}
                    onSelectModel={setSelectedModel}
                  />
                )}
            </div>
        </div>
    </div>
  );
}
