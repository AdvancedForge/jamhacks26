import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Task } from "../hackbuddyTypes";
import { hashColor } from "../hackbuddyUtils";

export const COLUMNS = ["Backlog", "In Progress", "Done"] as const;
const COL_COLOR = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" } as const;

export type CreateTaskInput = { title: string; description: string; column: string };

function Card({
  task,
  onClick,
  onDragStart,
}: {
  task: Task;
  onClick: () => void;
  onDragStart: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("taskId", task.id);
        onDragStart(task.id);
      }}
      onClick={onClick}
      className="bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] rounded-xl p-3.5 cursor-pointer transition-all group select-none"
    >
      <p className="text-[13px] font-medium text-white leading-snug mb-1.5">{task.title}</p>
      {task.description && <p className="text-[12px] text-[#71717a] leading-relaxed line-clamp-2 mb-2.5">{task.description}</p>}
      <div className="flex items-center justify-between">
        {task.assignee ? (
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0"
              style={{ background: hashColor(task.assignee) }}
            >
              {task.assignee[0].toUpperCase()}
            </div>
            <span className="text-[11px] text-[#52525b]">{task.assignee}</span>
          </div>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-[#3f3f46] font-mono">{task.id?.slice(0, 8)}</span>
      </div>
    </div>
  );
}

function InlineForm({
  column,
  onAdd,
  onCancel,
}: {
  column: string;
  onAdd: (data: CreateTaskInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), description: desc.trim(), column });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={ref}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") onCancel();
        }}
        placeholder="Task title…"
        className="bg-white/[0.03] border border-white/[0.1] focus:border-white/[0.2] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-[#52525b] outline-none transition-all"
      />
      <textarea
        value={desc}
        onChange={(event) => setDesc(event.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-[#52525b] outline-none resize-none transition-all"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-[12px] text-[#71717a] border border-white/[0.06] rounded-lg px-3 py-1.5 hover:border-white/[0.1] transition-all"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="text-[12px] font-medium bg-white text-[#09090b] rounded-lg px-3 py-1.5 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-40 transition-all"
        >
          Add task
        </button>
      </div>
    </div>
  );
}

export function Column({
  col,
  tasks,
  onAdd,
  onOpen,
  onDrop,
}: {
  col: string;
  tasks: Task[];
  onAdd: (data: CreateTaskInput) => void;
  onOpen: (task: Task) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, col: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`flex flex-col bg-[#0f1012]/60 backdrop-blur-sm border rounded-2xl w-[300px] shrink-0 transition-all ${
        over ? "border-white/[0.15] bg-white/[0.03]" : "border-white/[0.04]"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        onDrop(event, col);
      }}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/[0.04] shrink-0">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: COL_COLOR[col as keyof typeof COL_COLOR],
            boxShadow: `0 0 8px ${COL_COLOR[col as keyof typeof COL_COLOR]}60`,
          }}
        />
        <span className="text-[14px] font-medium text-white flex-1">{col}</span>
        <span className="text-[11px] text-[#52525b] bg-white/[0.04] rounded-full px-2.5 py-1 font-medium">{tasks.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 min-h-0">
        {tasks.length === 0 && !adding && (
          <div className="flex-1 flex items-center justify-center min-h-[80px] border border-dashed border-white/[0.06] rounded-xl">
            <span className="text-[12px] text-[#3f3f46]">Drop cards here</span>
          </div>
        )}
        {tasks.map((task) => (
          <Card key={task.id} task={task} onClick={() => onOpen(task)} onDragStart={() => {}} />
        ))}
      </div>

      <div className="px-3 pb-3 pt-1 shrink-0">
        {adding ? (
          <InlineForm
            column={col}
            onAdd={(data) => {
              onAdd(data);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 text-[13px] text-[#52525b] hover:text-[#71717a] hover:bg-white/[0.02] border border-dashed border-white/[0.06] hover:border-white/[0.1] rounded-xl px-3 py-2.5 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 8 1.5Z" />
            </svg>
            Add task
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskDrawer({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || "");
  const [assignee, setAssignee] = useState(task.assignee || "");
  const [col, setCol] = useState(task.column);
  const [delConfirm, setDelConfirm] = useState(false);

  const save = useCallback(() => {
    onSave({ ...task, title, description: desc, assignee, column: col, updated_at: Date.now() });
  }, [assignee, col, desc, onSave, task, title]);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-[380px] bg-[#0a0b0d]/95 backdrop-blur-xl border-l border-white/[0.04] z-50 flex flex-col animate-drawer">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04] shrink-0">
          <span className="font-mono text-[12px] text-[#52525b]">{task.id}</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#71717a] hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Title</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={save}
              className="w-full bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Description</label>
            <textarea
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
              onBlur={save}
              rows={4}
              placeholder="Add details…"
              className="w-full bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none resize-none transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Assignee</label>
            <div className="flex items-center gap-3">
              {assignee && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                  style={{ background: hashColor(assignee) }}
                >
                  {assignee[0].toUpperCase()}
                </div>
              )}
              <input
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                onBlur={save}
                placeholder="Name…"
                className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Column</label>
            <div className="flex gap-2">
              {COLUMNS.map((columnName) => (
                <button
                  key={columnName}
                  onClick={() => {
                    setCol(columnName);
                    onSave({ ...task, title, description: desc, assignee, column: columnName, updated_at: Date.now() });
                  }}
                  className={`flex-1 text-[12px] py-2 rounded-xl border transition-all ${
                    col === columnName
                      ? "border-white/[0.15] text-white bg-white/[0.06]"
                      : "border-white/[0.04] text-[#71717a] hover:border-white/[0.08]"
                  }`}
                >
                  {columnName}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-[#3f3f46]">Created {new Date(task.created_at).toLocaleString()}</div>
        </div>

        <div className="p-5 border-t border-white/[0.04] shrink-0">
          {delConfirm ? (
            <div className="flex gap-3">
              <button
                onClick={() => setDelConfirm(false)}
                className="flex-1 text-[13px] border border-white/[0.06] hover:border-white/[0.1] text-[#71717a] rounded-xl py-2.5 transition-all"
              >
                Keep it
              </button>
              <button
                onClick={() => onDelete(task.id)}
                className="flex-1 text-[13px] bg-[#ef4444]/10 border border-[#ef4444]/30 hover:border-[#ef4444]/50 text-[#ef4444] rounded-xl py-2.5 transition-all"
              >
                Yes, delete
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDelConfirm(true)}
              className="w-full flex items-center justify-center gap-2 text-[13px] text-[#ef4444] border border-[#ef4444]/20 hover:border-[#ef4444]/40 hover:bg-[#ef4444]/5 rounded-xl py-2.5 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.576l-.66-6.6a.75.75 0 1 1 1.492-.149Z" />
              </svg>
              Delete task
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
