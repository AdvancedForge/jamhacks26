import { useCallback, useEffect, useState, useRef } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";

const COL_COLOR: Record<string, string> = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" };

export default function RoadmapPage({ roomCode, toast }: { roomCode: string; toast: ToastFn }) {
  const [roadmap, setRoadmap] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch<{ roadmap: string; tasks: Task[] }>(`/api/board/${roomCode}`);
      setRoadmap(data.roadmap || "# Roadmap\n\nAdd your roadmap here.");
      setTasks(data.tasks || []);
      setLoading(false);
    } catch {
      toast("Failed to load roadmap.", "error");
    }
  }, [roomCode, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load marked.js
  useEffect(() => {
    if ((window as any).marked) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    script.async = true;
    script.onload = () => {
        // Configure marked - gfm: true should handle **bold** correctly
        (window as any).marked.setOptions({
            breaks: true,
            gfm: true,
        });
        // Trigger re-render
        if (!isEditing && previewRef.current && (window as any).marked) {
            previewRef.current.innerHTML = (window as any).marked.parse(roadmap);
        }
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  useEffect(() => {
    if (!isEditing && previewRef.current && (window as any).marked) {
      previewRef.current.innerHTML = (window as any).marked.parse(roadmap);
    }
  }, [isEditing, roadmap]);

  const saveRoadmap = async (newContent: string) => {
    setRoadmap(newContent);
    try {
      await apiFetch(`/api/roadmap/${roomCode}`, {
        method: "PUT",
        body: JSON.stringify({ roadmap: newContent }),
      });
    } catch {
      toast("Failed to save roadmap.", "error");
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 flex-none">
        <h2 className="text-xl font-bold">Roadmap</h2>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm transition-all"
        >
          {isEditing ? "Preview" : "Edit"}
        </button>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="flex gap-6 flex-1 min-h-0">
          <div className="w-1/2 h-full bg-[#0a0b0d] border border-white/10 rounded-lg text-white overflow-hidden">
            {isEditing ? (
              <textarea
                className="w-full h-full p-4 bg-transparent outline-none resize-none"
                value={roadmap}
                onChange={(e) => saveRoadmap(e.target.value)}
              />
            ) : (
              <div ref={previewRef} className="prose prose-invert max-w-none p-4 w-full h-full overflow-y-auto" />
            )}
          </div>
          <div className="w-1/2 h-full p-4 bg-[#0a0b0d] border border-white/10 rounded-lg text-white overflow-y-auto">
            <h3 className="font-bold mb-2">Live Tasks Status</h3>
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ background: COL_COLOR[task.column] || "#71717a" }} />
                <span>{task.title}</span>
                <span className="text-xs text-gray-500">[{task.column}]</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
