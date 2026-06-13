import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";

const COL_COLOR: Record<string, string> = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" };

export default function RoadmapPage({ roomCode, toast }: { roomCode: string; toast: ToastFn }) {
  const [roadmap, setRoadmap] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(true);

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

  // Simple Markdown renderer
  const renderMarkdown = (text: string) => {
    return text
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mb-2">$1</h1>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mb-2">$1</h2>')
      .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
      .replace(/\n/gim, '<br />');
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
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
        <div className="flex gap-6">
          <div className="w-1/2 h-[500px] p-4 bg-[#0a0b0d] border border-white/10 rounded-lg text-white font-mono overflow-y-auto">
            {isEditing ? (
              <textarea
                className="w-full h-full bg-transparent outline-none"
                value={roadmap}
                onChange={(e) => saveRoadmap(e.target.value)}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(roadmap) }} />
            )}
          </div>
          <div className="w-1/2 p-4 bg-[#0a0b0d] border border-white/10 rounded-lg text-white overflow-y-auto h-[500px]">
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
