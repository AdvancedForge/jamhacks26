/**
 * HackBuddy — Full Frontend
 * React + Vite + Tailwind compatible (plain JSX, no router dependency needed;
 * uses a minimal hash-router built in so you can drop this into src/App.jsx).
 *
 * API_BASE: set to your Vultr backend URL, e.g. "https://api.hackbuddy.io"
 * For local dev: "http://localhost:8000"
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

const WS_BASE = (import.meta.env.VITE_WS_BASE_URL || API_BASE)
  .replace(/^http:\/\//i, "ws://")
  .replace(/^https:\/\//i, "wss://")
  .replace(/\/$/, "");

// ─── helpers ────────────────────────────────────────────────────────────────

function hashColor(str: string) {
  if (!str) return "hsl(0,0%,40%)";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360}, 58%, 55%)`;
}

function genRoomCode() {
  return "HB-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ─── toast ──────────────────────────────────────────────────────────────────

type Toast = { id: number; msg: React.ReactNode; type: "success" | "error" | "warn" | string };

type Task = {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  column: string;
  created_at: number;
  updated_at: number;
  deleted?: boolean;
};

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((msg: React.ReactNode, type = "success") => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50 pointer-events-none">
      {toasts.map((t: Toast) => (
        <div
          key={t.id}
          className="flex items-center gap-3 bg-[#0f1012]/90 backdrop-blur-xl border border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-[#e4e4e7] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-slide-up"
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background:
                t.type === "error" ? "#ef4444" : t.type === "warn" ? "#f59e0b" : "#22c55e",
              boxShadow:
                t.type === "error" ? "0 0 12px rgba(239,68,68,0.5)" : t.type === "warn" ? "0 0 12px rgba(245,158,11,0.5)" : "0 0 12px rgba(34,197,94,0.5)",
            }}
          />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── entry screen ────────────────────────────────────────────────────────────

function EntryScreen({ onEnter }: { onEnter: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleCreate = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch("/api/room/create", { method: "POST" });
      const roomId = data.room_id;
      localStorage.setItem("hb_room", roomId);
      onEnter(roomId);
    } catch {
      // fallback: generate locally if backend unreachable
      const roomId = genRoomCode();
      localStorage.setItem("hb_room", roomId);
      onEnter(roomId);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) { setErr("Enter at least 4 characters."); return; }
    localStorage.setItem("hb_room", trimmed);
    onEnter(trimmed);
  };

  return (
    <div className="min-h-screen bg-[#08090a] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-[-20%] left-[50%] translate-x-[-50%] w-[600px] h-[600px] bg-[#3b82f6]/[0.08] rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-[400px] relative z-10">
        {/* logo */}
        <div className="mb-12 text-center">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
                <rect x="5" y="8" width="7" height="12" rx="1.5" fill="#ffffff" fillOpacity=".4"/>
                <rect x="14" y="5" width="9" height="7" rx="1.5" fill="#ffffff"/>
                <rect x="14" y="14" width="9" height="6" rx="1.5" fill="#ffffff" fillOpacity=".3"/>
              </svg>
            </div>
            <span className="text-white text-2xl font-semibold tracking-tight">
              Hack<span className="text-[#a1a1aa]">Buddy</span>
            </span>
          </div>
          <p className="text-[#71717a] text-[15px] leading-relaxed">
            Your hackathon co-pilot.<br/>One tab, the whole 36 hours.
          </p>
        </div>

        {/* card */}
        <div className="bg-[#0f1012]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 flex flex-col gap-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_50px_rgba(0,0,0,0.5)]">
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-[#09090b] font-semibold text-[14px] py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 8 1.5Z"/>
              </svg>
            )}
            Create new board
          </button>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[#52525b] text-[12px] uppercase tracking-wider">or join</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="flex gap-3">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Room code"
              className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all font-mono"
            />
            <button
              onClick={handleJoin}
              className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white text-[14px] font-medium px-5 rounded-xl transition-all whitespace-nowrap"
            >
              Join
            </button>
          </div>

          {err && <p className="text-[#ef4444] text-[13px]">{err}</p>}
        </div>

        <p className="text-center text-[#3f3f46] text-[13px] mt-6">
          No account needed. Share the code with your team.
        </p>
      </div>
    </div>
  );
}

// ─── topbar ──────────────────────────────────────────────────────────────────

const NAV = ["Board", "Whiteboard", "Integrations"];

function Topbar({ roomCode, page, onNav, polledAt }: { roomCode: string; page: string; onNav: (p: string) => void; polledAt: number }) {
  const [secAgo, setSecAgo] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecAgo(Math.floor((Date.now() - polledAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [polledAt]);

  return (
    <header className="flex items-center gap-4 px-6 bg-[#0a0b0d]/80 backdrop-blur-xl border-b border-white/[0.04] shrink-0 h-14">
      {/* logo */}
      <div className="flex items-center gap-2.5 mr-3">
        <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
            <rect x="5" y="8" width="7" height="12" rx="1.5" fill="#ffffff" fillOpacity=".4"/>
            <rect x="14" y="5" width="9" height="7" rx="1.5" fill="#ffffff"/>
            <rect x="14" y="14" width="9" height="6" rx="1.5" fill="#ffffff" fillOpacity=".3"/>
          </svg>
        </div>
        <span className="text-white text-[15px] font-semibold tracking-tight hidden sm:block">
          HackBuddy
        </span>
      </div>

      {/* nav */}
      <nav className="flex gap-1 bg-white/[0.02] border border-white/[0.04] rounded-lg p-1">
        {NAV.map((n) => (
          <button
            key={n}
            onClick={() => onNav(n)}
            className={`text-[13px] px-3 py-1.5 rounded-md transition-all ${
              page === n
                ? "bg-white/[0.08] text-white"
                : "text-[#71717a] hover:text-[#a1a1aa]"
            }`}
          >
            {n}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${secAgo < 5 ? "bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-[#52525b]"}`} />
          <span className="text-[12px] text-[#52525b] hidden sm:block">
            {secAgo < 5 ? "Live" : `${secAgo}s`}
          </span>
        </div>
        <div className="font-mono text-[12px] text-[#71717a] bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 tracking-wide">
          {roomCode}
        </div>
      </div>
    </header>
  );
}

// ─── kanban board ────────────────────────────────────────────────────────────

const COLUMNS = ["Backlog", "In Progress", "Done"];
const COL_COLOR = { Backlog: "#71717a", "In Progress": "#f59e0b", Done: "#22c55e" };

function Card({ task, onClick, onDragStart }: { task: Task; onClick: () => void; onDragStart: (id: string) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("taskId", task.id); onDragStart(task.id); }}
      onClick={onClick}
      className="bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] rounded-xl p-3.5 cursor-pointer transition-all group select-none"
    >
      <p className="text-[13px] font-medium text-white leading-snug mb-1.5">{task.title}</p>
      {task.description && (
        <p className="text-[12px] text-[#71717a] leading-relaxed line-clamp-2 mb-2.5">
          {task.description}
        </p>
      )}
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
        ) : <span />}
        <span className="text-[10px] text-[#3f3f46] font-mono">{task.id?.slice(0, 8)}</span>
      </div>
    </div>
  );
}

function InlineForm({ column, onAdd, onCancel }: { column: string; onAdd: (d: { title: string; description: string; column: string }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), description: desc.trim(), column });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        placeholder="Task title…"
        className="bg-white/[0.03] border border-white/[0.1] focus:border-white/[0.2] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-[#52525b] outline-none transition-all"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
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

function Column({ col, tasks, onAdd, onOpen, onDrop }: { col: string; tasks: Task[]; onAdd: (d: { title: string; description: string; column: string }) => void; onOpen: (t: Task) => void; onDrop: (e: React.DragEvent<HTMLDivElement>, col: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`flex flex-col bg-[#0f1012]/60 backdrop-blur-sm border rounded-2xl w-[300px] shrink-0 transition-all ${
        over ? "border-white/[0.15] bg-white/[0.03]" : "border-white/[0.04]"
      }`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e, col); }}
    >
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/[0.04] shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: COL_COLOR[col as keyof typeof COL_COLOR], boxShadow: `0 0 8px ${COL_COLOR[col as keyof typeof COL_COLOR]}60` }} />
        <span className="text-[14px] font-medium text-white flex-1">{col}</span>
        <span className="text-[11px] text-[#52525b] bg-white/[0.04] rounded-full px-2.5 py-1 font-medium">
          {tasks.length}
        </span>
      </div>

      {/* cards */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 min-h-0">
        {tasks.length === 0 && !adding && (
          <div className="flex-1 flex items-center justify-center min-h-[80px] border border-dashed border-white/[0.06] rounded-xl">
            <span className="text-[12px] text-[#3f3f46]">Drop cards here</span>
          </div>
        )}
        {tasks.map((t: Task) => (
          <Card key={t.id} task={t} onClick={() => onOpen(t)} onDragStart={() => {}} />
        ))}
      </div>

      {/* add */}
      <div className="px-3 pb-3 pt-1 shrink-0">
        {adding ? (
          <InlineForm
            column={col}
            onAdd={(d: any) => { onAdd(d); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 text-[13px] text-[#52525b] hover:text-[#71717a] hover:bg-white/[0.02] border border-dashed border-white/[0.06] hover:border-white/[0.1] rounded-xl px-3 py-2.5 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 8 1.5Z"/>
            </svg>
            Add task
          </button>
        )}
      </div>
    </div>
  );
}

function TaskDrawer({ task, onClose, onSave, onDelete }: { task: Task; onClose: () => void; onSave: (t: Task) => void; onDelete: (id: string) => void }) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || "");
  const [assignee, setAssignee] = useState(task.assignee || "");
  const [col, setCol] = useState(task.column);
  const [delConfirm, setDelConfirm] = useState(false);

  const save = useCallback(() => {
    onSave({ ...task, title, description: desc, assignee, column: col, updated_at: Date.now() });
  }, [task, title, desc, assignee, col]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 bottom-0 w-[380px] bg-[#0a0b0d]/95 backdrop-blur-xl border-l border-white/[0.04] z-50 flex flex-col animate-drawer">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04] shrink-0">
          <span className="font-mono text-[12px] text-[#52525b]">{task.id}</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#71717a] hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={save}
              className="w-full bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
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
                onChange={(e) => setAssignee(e.target.value)}
                onBlur={save}
                placeholder="Name…"
                className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#52525b] font-medium mb-2">Column</label>
            <div className="flex gap-2">
              {COLUMNS.map((c) => (
                <button
                  key={c}
                  onClick={() => { setCol(c); onSave({ ...task, title, description: desc, assignee, column: c, updated_at: Date.now() }); }}
                  className={`flex-1 text-[12px] py-2 rounded-xl border transition-all ${
                    col === c
                      ? "border-white/[0.15] text-white bg-white/[0.06]"
                      : "border-white/[0.04] text-[#71717a] hover:border-white/[0.08]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-[#3f3f46]">
            Created {new Date(task.created_at).toLocaleString()}
          </div>
        </div>

        {/* footer */}
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
                <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.576l-.66-6.6a.75.75 0 1 1 1.492-.149Z"/>
              </svg>
              Delete task
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function BoardPage({ roomCode, toast, onPoll }: { roomCode: string; toast: (msg: React.ReactNode, type?: string) => void; onPoll?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drawer, setDrawer] = useState<Task | null>(null);
  const [retries, setRetries] = useState(0);
  const [voiceLoading, setVoiceLoading] = useState(false);

  const fetchBoard = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/board/${roomCode}`);
      setTasks((data.tasks || []).filter((t: Task) => !t.deleted));
      onPoll?.();
      setRetries(0);
    } catch {
      setRetries((r) => r + 1);
    }
  }, [roomCode]);

  useEffect(() => {
    fetchBoard();
    const t = setInterval(fetchBoard, 3000);
    return () => clearInterval(t);
  }, [fetchBoard]);

  useEffect(() => {
    if (retries >= 15) toast("Lost connection. Showing stale data.", "error");
  }, [retries]);

  const handleAdd = async ({ title, description, column }: { title: string; description: string; column: string }) => {
    const now = Date.now();
    const optimistic: Task = { id: `t_${Math.random().toString(36).slice(2,7)}`, title, description, column, assignee: "", created_at: now, updated_at: now };
    setTasks((t) => [...t, optimistic]);
    try {
      await apiFetch(`/api/task/create?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ title, description, column, assignee: "", created_at: now }),
      });
      toast(`Task added to ${column}`);
      // Refresh board silently - errors handled by polling
      fetchBoard().catch(() => {});
    } catch {
      toast("Failed to save task.", "error");
    }
  };

  const handleSave = async (updated: Task) => {
    setTasks((t) => t.map((x) => (x.id === updated.id ? updated : x)));
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
    setTasks((t) => t.filter((x) => x.id !== id));
    setDrawer(null);
    try {
      await apiFetch(`/api/task/${id}?room_id=${roomCode}`, { method: "DELETE" });
      toast("Task deleted");
    } catch {
      toast("Delete failed.", "error");
    }
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, col: string) => {
    const id = e.dataTransfer.getData("taskId");
    const task = tasks.find((t) => t.id === id);
    if (!task || task.column === col) return;
    handleSave({ ...task, column: col, updated_at: Date.now() });
    toast(`Moved to ${col}`);
  };

  const handleVoice = async () => {
    setVoiceLoading(true);
    try {
      const { job_id } = await apiFetch(`/api/voice/speak?room_id=${roomCode}`, {
        method: "POST",
        body: JSON.stringify({ tasks }),
      });
      // poll for audio
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const job = await apiFetch(`/api/voice/${job_id}`);
          if (job.status === "completed" && job.audio_url) {
            clearInterval(poll);
            setVoiceLoading(false);
            new Audio(`${API_BASE}${job.audio_url}`).play();
            toast("Playing board summary");
          }
        } catch {}
        if (tries > 20) { clearInterval(poll); setVoiceLoading(false); toast("Voice timed out.", "warn"); }
      }, 1500);
    } catch {
      setVoiceLoading(false);
      toast("Voice unavailable.", "warn");
    }
  };

  const colTasks = (col: string) => tasks.filter((t) => t.column === col);

  return (
    <div className="flex flex-col h-full bg-[#08090a] relative">
      {/* Ambient glow */}
      <div className="absolute top-0 right-[20%] w-[500px] h-[400px] bg-[#3b82f6]/[0.04] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-[10%] w-[400px] h-[300px] bg-[#8b5cf6]/[0.03] rounded-full blur-[100px] pointer-events-none" />
      
      {/* board topbar strip */}
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
              <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z"/>
              <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.061Z"/>
            </svg>
          )}
          Read update
        </button>
      </div>

      {/* columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-5 flex gap-4 min-h-0 relative z-10">
        {COLUMNS.map((col) => (
          <Column
            key={col}
            col={col}
            tasks={colTasks(col)}
            onAdd={handleAdd}
            onOpen={setDrawer}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {drawer && (
        <TaskDrawer
          task={drawer}
          onClose={() => setDrawer(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ─── whiteboard page ──────────────────────────────────────────────────────────

function WhiteboardPage({ roomCode, toast }: { roomCode: string; toast: (msg: React.ReactNode, type?: string) => void }) {
  const [framework, setFramework] = useState<string>("react");
  const [status, setStatus] = useState<string>("idle"); // idle | loading | done | error
  const [code, setCode] = useState<string>("");
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [syncState, setSyncState] = useState<"connecting" | "live" | "offline">("connecting");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const applyingRemoteRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSceneSignatureRef = useRef("");
  const lastServerUpdateRef = useRef(0);

  const normalizeScene = useCallback((scene: any) => {
    const elements: readonly unknown[] = Array.isArray(scene?.elements) ? scene.elements : [];
    const files = scene?.files && typeof scene.files === "object" ? scene.files : {};
    return { elements, files };
  }, []);
  const sceneSignature = useCallback((scene: { elements: readonly unknown[]; files: Record<string, any> }) => {
    return JSON.stringify({ elements: scene.elements, files: scene.files });
  }, []);

  const applyRemoteScene = useCallback((scene: any) => {
    if (!excalidrawAPI) return;
    const normalized = normalizeScene(scene);
    const signature = sceneSignature(normalized);
    if (signature === lastSceneSignatureRef.current) return;

    applyingRemoteRef.current = true;
    excalidrawAPI.updateScene(normalized);
    lastSceneSignatureRef.current = signature;
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }, [excalidrawAPI, normalizeScene, sceneSignature]);

  const fetchSharedScene = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/whiteboard/scene/${roomCode}`);
      const updatedAt = Number(data?.updated_at || 0);
      if (!lastServerUpdateRef.current || updatedAt >= lastServerUpdateRef.current) {
        lastServerUpdateRef.current = updatedAt;
        applyRemoteScene(data?.scene);
      }
      setSyncState("live");
      setLastSyncedAt(Date.now());
    } catch {
      setSyncState("offline");
    }
  }, [applyRemoteScene, roomCode]);

  const pushSharedScene = useCallback(async (elements: readonly unknown[], files: Record<string, any>) => {
    const scene = normalizeScene({ elements, files });
    const signature = sceneSignature(scene);
    if (signature === lastSceneSignatureRef.current) return;

    try {
      const data = await apiFetch(`/api/whiteboard/scene/${roomCode}`, {
        method: "PUT",
        body: JSON.stringify({ scene }),
      });
      lastSceneSignatureRef.current = signature;
      lastServerUpdateRef.current = Number(data?.updated_at || Date.now());
      setSyncState("live");
      setLastSyncedAt(Date.now());
    } catch {
      setSyncState("offline");
    }
  }, [normalizeScene, roomCode, sceneSignature]);

  const queueSceneSave = useCallback((elements: readonly unknown[], files: Record<string, any>) => {
    if (applyingRemoteRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      pushSharedScene(elements, files);
    }, 450);
  }, [pushSharedScene]);

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
        const message = JSON.parse(event.data);
        if (message?.type === "WHITEBOARD_UPDATED") {
          const updatedAt = Number(message?.updated_at || 0);
          if (updatedAt > lastServerUpdateRef.current) {
            lastServerUpdateRef.current = updatedAt;
            fetchSharedScene();
          }
        }
      } catch {
        // ignore non-json socket traffic
      }
    };
    ws.onerror = () => setSyncState("offline");

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
    if (!excalidrawAPI) { toast("Canvas not ready.", "warn"); return; }
    const elements = excalidrawAPI.getSceneElements();
    if (!elements.length) { toast("Draw something first.", "warn"); return; }

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
          const { job_id } = await apiFetch(`/api/whiteboard/generate?room_id=${roomCode}`, {
            method: "POST",
            body: JSON.stringify({ image_base64: base64, framework }),
          });
          // poll
          let tries = 0;
          const poll = setInterval(async () => {
            tries++;
            try {
              const job = await apiFetch(`/api/whiteboard/${job_id}`);
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
            } catch {}
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

  const copyCode = () => { navigator.clipboard.writeText(code); toast("Copied to clipboard"); };
  const downloadCode = () => {
    const ext = framework === "react" ? "jsx" : "html";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    a.download = `GeneratedLayout.${ext}`;
    a.click();
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
      {/* toolbar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-white/[0.04] shrink-0">
        <div className="flex bg-white/[0.02] border border-white/[0.04] rounded-xl p-1 gap-1">
          {["react", "html"].map((f) => (
            <button
              key={f}
              onClick={() => setFramework(f)}
              className={`text-[12px] px-4 py-1.5 rounded-lg transition-all ${
                framework === f
                  ? "bg-white/[0.08] text-white"
                  : "text-[#52525b] hover:text-[#71717a]"
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
              <path d="M12 .75a8.25 8.25 0 0 1 4.135 15.4c.34.12.617.4.617.785V18a1.5 1.5 0 0 1-1.5 1.5h-6.5A1.5 1.5 0 0 1 7.25 18v-1.065c0-.385.277-.665.617-.785A8.25 8.25 0 0 1 12 .75Z"/>
            </svg>
          )}
          Generate code
        </button>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[12px] text-[#52525b] flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${syncStatusDotClass}`} />
            {syncStatusText}
          </span>
          <span className="text-[12px] text-[#52525b]">
            Draw a UI sketch, then generate {framework === "react" ? "React" : "HTML"} code
          </span>
        </div>
      </div>

      {/* split pane */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* canvas */}
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
            onChange={(elements: readonly unknown[], _appState: unknown, files: Record<string, any>) => {
              queueSceneSave(elements, files || {});
            }}
          />
        </div>

        {/* code panel */}
        <div className="w-[460px] shrink-0 flex flex-col bg-[#0a0b0d]/90 backdrop-blur-xl">
          {/* code panel header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.04] shrink-0">
            <span className="text-[14px] font-medium text-white">Generated code</span>
            {status === "done" && (
              <div className="flex gap-2">
                <button
                  onClick={copyCode}
                  className="text-[12px] text-[#71717a] hover:text-white flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-lg px-3 py-1.5 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
                    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
                  </svg>
                  Copy
                </button>
                <button
                  onClick={downloadCode}
                  className="text-[12px] text-[#71717a] hover:text-white flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1] rounded-lg px-3 py-1.5 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
                    <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"/>
                  </svg>
                  Download
                </button>
              </div>
            )}
          </div>

          {/* code content */}
          <div className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed p-5 bg-[#08090a]">
            {status === "idle" && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#52525b">
                    <path d="m6.75 4.5 5.25 3-5.25 3V4.5ZM3 3.75A.75.75 0 0 1 3.75 3h.75a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75h-.75A.75.75 0 0 1 3 20.25V3.75Z"/>
                  </svg>
                </div>
                <p className="text-[#3f3f46] text-[13px]">Draw a UI sketch on the canvas,<br/>then hit Generate code.</p>
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
                <button onClick={handleGenerate} className="text-[#71717a] text-[12px] hover:text-white transition-colors">Try again</button>
              </div>
            )}
            {status === "done" && code && (
              <>
                <pre className="text-[#a1a1aa] whitespace-pre-wrap break-words">{code}</pre>
                <p className="text-[#3f3f46] text-[11px] mt-5 border-t border-white/[0.04] pt-4">
                  Paste into your project and start building.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── integrations page ────────────────────────────────────────────────────────

function IntegrationsPage({ roomCode, toast }: { roomCode: string; toast: (msg: React.ReactNode, type?: string) => void }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [commits, setCommits] = useState<any[]>([]);
  const [connecting, setConnecting] = useState(false);

  const fetchCommits = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/git/${roomCode}`);
      setCommits(data.commits || []);
    } catch {}
  }, [roomCode]);

  useEffect(() => {
    if (!connected) return;
    fetchCommits();
    const t = setInterval(fetchCommits, 30000);
    return () => clearInterval(t);
  }, [connected, fetchCommits]);

  const handleConnect = async () => {
    if (!repoUrl.trim()) { toast("Enter a repo URL.", "warn"); return; }
    setConnecting(true);
    try {
      await apiFetch(`/api/git/${roomCode}/connect`, {
        method: "POST",
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      setConnected(true);
      toast("Repo connected");
      await fetchCommits();
    } catch {
      toast("Couldn't connect repo.", "error");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-[#08090a]">
      <div className="max-w-2xl mx-auto flex flex-col gap-10">

        {/* git tracker */}
        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">Git tracker</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Connect a public GitHub repo. Commits appear here automatically. Include a task ID like{" "}
            <code className="text-[#a1a1aa] bg-white/[0.04] px-2 py-0.5 rounded text-[12px]">[t_001]</code>{" "}
            in a commit message to auto-move that card to Done.
          </p>

          {!connected ? (
            <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-4">
              <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">GitHub repo URL</label>
              <div className="flex gap-3">
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  placeholder="https://github.com/you/your-repo"
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
                />
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] text-[#09090b] text-[14px] font-medium px-5 rounded-xl transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  {connecting && <span className="w-3.5 h-3.5 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" />}
                  Connect
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
                <span className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.5)] shrink-0" />
                <span className="text-[14px] text-white font-medium truncate">{repoUrl}</span>
                <span className="ml-auto text-[11px] text-[#52525b]">Polling every 30s</span>
              </div>

              {commits.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-[#3f3f46] text-[14px]">No commits yet — push something!</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {commits.map((c, i) => (
                    <div key={c.id || i} className="flex items-start gap-4 px-5 py-4">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0"
                        style={{ background: hashColor(c.author || c.author_name || "?") }}
                      >
                        {(c.author || c.author_name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-white leading-snug truncate">{c.message || c.commit_message}</p>
                        <p className="text-[12px] text-[#52525b] mt-1">
                          {c.author || c.author_name} · {c.created_at ? timeAgo(c.created_at * 1000) : ""}
                        </p>
                      </div>
                      {(c.additions != null || c.deletions != null) && (
                        <div className="flex gap-2 text-[12px] shrink-0">
                          {c.additions != null && <span className="text-[#22c55e]">+{c.additions}</span>}
                          {c.deletions != null && <span className="text-[#ef4444]">−{c.deletions}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* voice */}
        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">ElevenLabs voice</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            The Read update button on the Board page reads a brief standup summary of your current task state aloud.
            Configure your ElevenLabs voice ID in the backend <code className="text-[#a1a1aa] bg-white/[0.04] px-2 py-0.5 rounded text-[12px]">.env</code>.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#71717a">
                  <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z"/>
                </svg>
              </div>
              <div>
                <p className="text-[14px] text-white font-medium">ElevenLabs multilingual v2</p>
                <p className="text-[13px] text-[#52525b]">Triggered from the Board page — reads live task data</p>
              </div>
              <div className="ml-auto text-[11px] text-[#52525b] bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-lg">
                Set ELEVENLABS_API_KEY in .env
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

// ─── root app ─────────────────────────────────────────────────────────────────

export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("hb_room") || "");
  const [page, setPage] = useState("Board");
  const [polledAt, setPolledAt] = useState(Date.now());
  const { toasts, add: toast } = useToasts();

  const handleEnter = (code: string) => {
    setRoomCode(code);
    setPage("Board");
  };

  if (!roomCode) return (
    <>
      <EntryScreen onEnter={handleEnter} />
      <ToastList toasts={toasts} />
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-[#08090a] text-white overflow-hidden">
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawer {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-up  { animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-drawer    { animation: drawer 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>

      <Topbar
        roomCode={roomCode}
        page={page}
        onNav={setPage}
        polledAt={polledAt}
      />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {page === "Board" && (
          <BoardPage roomCode={roomCode} toast={toast} onPoll={() => setPolledAt(Date.now())} />
        )}
        {page === "Whiteboard" && (
          <WhiteboardPage roomCode={roomCode} toast={toast} />
        )}
        {page === "Integrations" && (
          <IntegrationsPage roomCode={roomCode} toast={toast} />
        )}
      </main>

      <ToastList toasts={toasts} />
    </div>
  );
}