import { useCallback, useEffect, useState, useRef } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { Task, ToastFn } from "../hackbuddyTypes";
import { DndContext, closestCenter, useDroppable, DragOverlay } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const COL_COLOR: Record<string, string> = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" };

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
  const visionPreviewRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch<{ roadmap: string; tasks: Task[] }>(`/api/board/${roomCode}`);
      
      let parsedRoadmap = { vision: "Add vision here...", phases: {} };
      if (data.roadmap) {
        try {
            parsedRoadmap = JSON.parse(data.roadmap);
        } catch (e) {
            console.error("Failed to parse roadmap JSON, treating as raw text", e);
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load marked.js
  useEffect(() => {
    if ((window as any).marked) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  // Render markdown for Vision
  useEffect(() => {
    if (!isEditingVision && visionPreviewRef.current && (window as any).marked) {
        visionPreviewRef.current.innerHTML = (window as any).marked.parse(roadmap.vision);
    }
  }, [isEditingVision, roadmap.vision]);

  const saveRoadmap = async (newRoadmap: typeof roadmap) => {
    setRoadmap(newRoadmap);
    try {
      await apiFetch(`/api/roadmap/${roomCode}`, {
        method: "PUT",
        body: JSON.stringify({ roadmap: JSON.stringify(newRoadmap) }),
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
      const newPhases = { ...roadmap.phases };
      delete newPhases[phase];
      saveRoadmap({ ...roadmap, phases: newPhases });
    }
  };

  const onDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const onDragEnd = (event: any) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;
    
    // Find containers
    const activePhase = Object.keys(roadmap.phases).find(p => roadmap.phases[p].includes(activeId)) || "unassigned";
    const overPhase = Object.keys(roadmap.phases).find(p => roadmap.phases[p].includes(overId)) || (overId in roadmap.phases ? overId : null);

    if (!overPhase) return;

    const newRoadmap = { ...roadmap, phases: { ...roadmap.phases } };
    
    // Remove from old
    if (activePhase !== "unassigned") {
        newRoadmap.phases[activePhase] = newRoadmap.phases[activePhase].filter(id => id !== activeId);
    }

    // Add to new
    if (overPhase !== "unassigned") {
        if (!newRoadmap.phases[overPhase]) newRoadmap.phases[overPhase] = [];
        
        // If dropped onto a specific task, insert before it
        const overIndex = newRoadmap.phases[overPhase].indexOf(overId);
        if (overIndex !== -1) {
            newRoadmap.phases[overPhase].splice(overIndex, 0, activeId);
        } else {
            newRoadmap.phases[overPhase].push(activeId);
        }
    }
    
    saveRoadmap(newRoadmap);
  };

  return (
    <div data-tour="roadmap-workspace" className="p-6 h-full flex flex-col gap-6">
      <div className="flex justify-between items-center flex-none">
        <h2 className="text-xl font-bold">Roadmap</h2>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="flex gap-6 flex-1 min-h-0">
          {/* Vision Section */}
          <div className="w-1/2 h-full bg-[#0a0b0d] border border-white/10 rounded-lg text-white p-4 flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-none">
                <h3 className="font-bold">Project Vision (Markdown)</h3>
                <button
                    onClick={() => setIsEditingVision(!isEditingVision)}
                    className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition-all"
                >
                    {isEditingVision ? "Save" : "Edit"}
                </button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              {isEditingVision ? (
                <textarea
                  className="w-full h-full bg-transparent outline-none resize-none overflow-y-auto"
                  value={roadmap.vision}
                  placeholder="Describe your project vision in detail using markdown..."
                  onChange={(e) => saveRoadmap({ ...roadmap, vision: e.target.value })}
                />
              ) : (
                <div ref={visionPreviewRef} className="prose prose-invert max-w-none h-full overflow-y-auto" />
              )}
            </div>
          </div>

          {/* Implementation Order Section */}
          <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="w-1/2 h-full bg-[#0a0b0d] border border-white/10 rounded-lg text-white overflow-y-auto p-4">
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
                            const task = tasks.find(t => t.id === id);
                            if (!task) return null;
                            return <SortableTask key={id} id={id} task={task} />;
                            })}
                        </SortableContext>
                    </PhaseContainer>
                </div>
                ))}
                {/* Unassigned Tasks */}
                <div className="mt-8">
                    <h4 className="font-semibold text-gray-400 mb-2">Unassigned</h4>
                    <PhaseContainer id="unassigned">
                        <SortableContext items={tasks.filter(t => !Object.values(roadmap.phases).flat().includes(t.id)).map(t => t.id)} strategy={verticalListSortingStrategy}>
                            {tasks.filter(t => !Object.values(roadmap.phases).flat().includes(t.id)).map((task) => (
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
                        <span className="flex-1">{(tasks.find(t => t.id === activeId) || {title: 'Dragging...'}).title}</span>
                    </div>
                ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  );
}
