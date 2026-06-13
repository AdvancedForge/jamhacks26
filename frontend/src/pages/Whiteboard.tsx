import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { WS_BASE, apiFetch } from "../hackbuddyApi";
import type { ToastFn } from "../hackbuddyTypes";
import { timeAgo } from "../hackbuddyUtils";

export default function WhiteboardPage({ roomCode, toast }: { roomCode: string; toast: ToastFn }) {
  type SceneElement = Record<string, unknown>;
  type SceneFiles = Record<string, unknown>;
  type SceneState = { elements: SceneElement[]; files: SceneFiles };

  const [framework, setFramework] = useState<string>("react");
  const [status, setStatus] = useState<string>("idle");
  const [code, setCode] = useState<string>("");
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [syncState, setSyncState] = useState<"connecting" | "live" | "offline">("connecting");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const applyingRemoteRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSceneSignatureRef = useRef("");
  const lastServerUpdateRef = useRef(0);
  const lastSceneVersionRef = useRef(0);
  const fetchRequestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const hasLoadedInitialSceneRef = useRef(false);
  const actorIdRef = useRef(`wb_${Math.random().toString(36).slice(2, 10)}`);

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
    async (elements: readonly unknown[], files: unknown) => {
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
      } catch {
        if (requestId === saveRequestIdRef.current) {
          setSyncState("offline");
        }
      }
    },
    [applyRemoteScene, normalizeScene, roomCode, sceneSignature],
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

    try {
      const blob = await exportToBlob({
        elements,
        appState: { background: "#ffffff" },
        files: excalidrawAPI.getFiles(),
      });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result;
        if (!result || typeof result !== "string") {
          setStatus("error");
          toast("Export failed.", "error");
          return;
        }
        const base64 = result.split(",")[1];
        try {
          const { job_id } = await apiFetch<{ job_id: string }>(`/api/whiteboard/generate?room_id=${roomCode}`, {
            method: "POST",
            body: JSON.stringify({ image_base64: base64, framework }),
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
      reader.readAsDataURL(blob);
    } catch {
      setStatus("error");
      toast("Export failed.", "error");
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    toast("Copied to clipboard");
  };

  const downloadCode = () => {
    const ext = framework === "react" ? "jsx" : "html";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    anchor.download = `GeneratedLayout.${ext}`;
    anchor.click();
  };

  const syncStatusDotClass =
    syncState === "offline"
      ? "bg-[#ef4444] shadow-[0_0_8px_rgba(239,68,68,0.55)]"
      : "bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.55)]";

  const syncStatusText =
    syncState === "offline"
      ? "Shared sync offline"
      : lastSyncedAt
        ? `Shared board synced ${timeAgo(lastSyncedAt)}`
        : "Connecting shared board…";

  return (
    <div className="flex flex-col h-full bg-[#08090a]">
      <div className="flex items-center gap-4 px-6 py-3 border-b border-white/[0.04] shrink-0">
        <div className="flex bg-white/[0.02] border border-white/[0.04] rounded-xl p-1 gap-1">
          {["react", "html"].map((f) => (
            <button
              key={f}
              onClick={() => setFramework(f)}
              className={`text-[12px] px-4 py-1.5 rounded-lg transition-all ${
                framework === f ? "bg-white/[0.08] text-white" : "text-[#52525b] hover:text-[#71717a]"
              }`}
            >
              {f === "react" ? "React" : "HTML"}
            </button>
          ))}
        </div>
        <button
          onClick={handleGenerate}
          disabled={status === "loading"}
          className="flex items-center gap-2 bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] disabled:opacity-50 text-[#09090b] text-[13px] font-semibold px-5 py-2 rounded-xl transition-all"
        >
          {status === "loading" ? (
            <span className="w-3.5 h-3.5 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .75a8.25 8.25 0 0 1 4.135 15.4c.34.12.617.4.617.785V18a1.5 1.5 0 0 1-1.5 1.5h-6.5A1.5 1.5 0 0 1 7.25 18v-1.065c0-.385.277-.665.617-.785A8.25 8.25 0 0 1 12 .75Z" />
            </svg>
          )}
          Generate code
        </button>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[12px] text-[#52525b] flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${syncStatusDotClass}`} />
            {syncStatusText}
          </span>
          <span className="text-[12px] text-[#52525b]">Draw a UI sketch, then generate {framework === "react" ? "React" : "HTML"} code</span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 border-r border-white/[0.04]">
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
        </div>

        <div className="w-[460px] shrink-0 flex flex-col bg-[#0a0b0d]/90 backdrop-blur-xl">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.04] shrink-0">
            <span className="text-[14px] font-medium text-white">Generated code</span>
            {status === "done" && (
              <div className="flex gap-2">
                <button
                  onClick={copyCode}
                  className="text-[12px] text-[#71717a] hover:text-white flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-lg px-3 py-1.5 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
                    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                  </svg>
                  Copy
                </button>
                <button
                  onClick={downloadCode}
                  className="text-[12px] text-[#71717a] hover:text-white flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-lg px-3 py-1.5 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
                    <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z" />
                  </svg>
                  Download
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed p-5 bg-[#08090a]">
            {status === "idle" && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#52525b">
                    <path d="m6.75 4.5 5.25 3-5.25 3V4.5ZM3 3.75A.75.75 0 0 1 3.75 3h.75a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75h-.75A.75.75 0 0 1 3 20.25V3.75Z" />
                  </svg>
                </div>
                <p className="text-[#3f3f46] text-[13px]">
                  Draw a UI sketch on the canvas,
                  <br />
                  then hit Generate code.
                </p>
              </div>
            )}
            {status === "loading" && (
              <div className="flex flex-col gap-3 pt-2">
                {[80, 60, 90, 50, 70, 40].map((w, i) => (
                  <div key={i} className="h-3 bg-white/[0.04] rounded animate-pulse" style={{ width: `${w}%` }} />
                ))}
                <p className="text-[#3f3f46] text-[12px] mt-3">Generating code from your sketch…</p>
              </div>
            )}
            {status === "error" && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-[#ef4444] text-[13px]">Generation failed.</p>
                <button onClick={handleGenerate} className="text-[#71717a] text-[12px] hover:text-white transition-colors">
                  Try again
                </button>
              </div>
            )}
            {status === "done" && code && (
              <>
                <pre className="text-[#a1a1aa] whitespace-pre-wrap break-words">{code}</pre>
                <p className="text-[#3f3f46] text-[11px] mt-5 border-t border-white/[0.04] pt-4">Paste into your project and start building.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
