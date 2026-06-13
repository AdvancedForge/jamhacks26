export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

export const WS_BASE = (import.meta.env.VITE_WS_BASE_URL || API_BASE)
  .replace(/^http:\/\//i, "ws://")
  .replace(/^https:\/\//i, "wss://")
  .replace(/\/$/, "");

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const customGeminiKey = localStorage.getItem('hackpilot_gemini_key');
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
    ...(customGeminiKey ? { "X-Gemini-API-Key": customGeminiKey } : {}),
    ...(typeof opts.headers === 'object' ? opts.headers as Record<string, string> : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
