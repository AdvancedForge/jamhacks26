export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

export const WS_BASE = (import.meta.env.VITE_WS_BASE_URL || API_BASE)
  .replace(/^http:\/\//i, "ws://")
  .replace(/^https:\/\//i, "wss://")
  .replace(/\/$/, "");

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
    ...(typeof opts.headers === "object" ? (opts.headers as Record<string, string>) : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const payload = await res.json();
      const detail = payload?.detail;
      if (typeof detail === "string" && detail.trim()) {
        message = detail.trim();
      }
    } catch {
      // Fallback to status text.
    }
    throw new Error(message);
  }
  return res.json();
}
