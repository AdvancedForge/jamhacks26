import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { ToastFn } from "../hackbuddyTypes";
import { hashColor, timeAgo } from "../hackbuddyUtils";

type Commit = {
  id?: string;
  author?: string;
  author_name?: string;
  message?: string;
  commit_message?: string;
  created_at?: number;
  additions?: number;
  deletions?: number;
};

export default function IntegrationsPage({ roomCode, toast }: { roomCode: string; toast: ToastFn }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('hackpilot_gemini_key') || '');

  const saveGeminiKey = () => {
    localStorage.setItem('hackpilot_gemini_key', geminiKey);
    toast("Gemini API Key saved!", "success");
  };

  const fetchCommits = useCallback(async () => {
    try {
      const data = await apiFetch<{ commits?: Commit[] }>(`/api/git/${roomCode}`);
      setCommits(data.commits || []);
    } catch {
      // no-op
    }
  }, [roomCode]);

  useEffect(() => {
    if (!connected) return;
    fetchCommits();
    const timer = setInterval(fetchCommits, 30000);
    return () => clearInterval(timer);
  }, [connected, fetchCommits]);

  const handleConnect = async () => {
    if (!repoUrl.trim()) {
      toast("Enter a repo URL.", "warn");
      return;
    }
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
        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">Git tracker</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Connect a public GitHub repo. Commits appear here automatically. Include a task ID like{" "}
            <code className="text-[#a1a1aa] bg-white/[0.04] px-2 py-0.5 rounded text-[12px]">[t_001]</code> in a commit message
            to auto-move that card to Done.
          </p>

          {!connected ? (
            <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-4">
              <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">GitHub repo URL</label>
              <div className="flex gap-3">
                <input
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleConnect()}
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
                  {commits.map((commit, index) => (
                    <div key={commit.id || index} className="flex items-start gap-4 px-5 py-4">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0"
                        style={{ background: hashColor(commit.author || commit.author_name || "?") }}
                      >
                        {(commit.author || commit.author_name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-white leading-snug truncate">{commit.message || commit.commit_message}</p>
                        <p className="text-[12px] text-[#52525b] mt-1">
                          {commit.author || commit.author_name} · {commit.created_at ? timeAgo(commit.created_at * 1000) : ""}
                        </p>
                      </div>
                      {(commit.additions != null || commit.deletions != null) && (
                        <div className="flex gap-2 text-[12px] shrink-0">
                          {commit.additions != null && <span className="text-[#22c55e]">+{commit.additions}</span>}
                          {commit.deletions != null && <span className="text-[#ef4444]">−{commit.deletions}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">HackPilot API Key</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Set your custom Gemini API key for your session to use HackBuddy AI.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex gap-3">
             <input
                  type="password"
                  value={geminiKey}
                  onChange={(event) => setGeminiKey(event.target.value)}
                  placeholder="AI_KEY_..."
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
                />
                <button
                  onClick={saveGeminiKey}
                  className="bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] text-[#09090b] text-[14px] font-medium px-5 rounded-xl transition-all whitespace-nowrap"
                >
                  Save Key
                </button>
          </div>
        </section>
      </div>
    </div>
  );
}
