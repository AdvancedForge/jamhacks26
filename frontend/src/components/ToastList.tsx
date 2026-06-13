import type { Toast } from "../hackbuddyTypes";

export default function ToastList({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-3 bg-[#0f1012]/90 backdrop-blur-xl border border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-[#e4e4e7] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-slide-up"
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background:
                toast.type === "error" ? "#ef4444" : toast.type === "warn" ? "#f59e0b" : "#22c55e",
              boxShadow:
                toast.type === "error"
                  ? "0 0 12px rgba(239,68,68,0.5)"
                  : toast.type === "warn"
                    ? "0 0 12px rgba(245,158,11,0.5)"
                    : "0 0 12px rgba(34,197,94,0.5)",
            }}
          />
          {toast.msg}
        </div>
      ))}
    </div>
  );
}
