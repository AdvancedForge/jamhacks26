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
          <h2 className="text-[18px] font-semibold text-white mb-2">ElevenLabs voice</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            The Read update button on the Board page reads a brief standup summary of your current task state aloud. Configure your
            ElevenLabs voice ID in the backend{" "}
            <code className="text-[#a1a1aa] bg-white/[0.04] px-2 py-0.5 rounded text-[12px]">.env</code>.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#71717a">
                  <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
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
