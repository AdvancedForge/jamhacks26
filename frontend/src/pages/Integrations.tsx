import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { OnboardingProfile, ToastFn } from "../hackbuddyTypes";
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

type IdeaSuggestion = {
  title: string;
  pitch: string;
  fit: string;
};

const toSkillsInput = (profile: OnboardingProfile | null) => (profile?.skills || []).join(", ");

const parseSkills = (raw: string) =>
  raw
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

export default function IntegrationsPage({
  roomCode,
  toast,
  profile,
  onProfileChange,
}: {
  roomCode: string;
  toast: ToastFn;
  profile: OnboardingProfile | null;
  onProfileChange: (profile: OnboardingProfile) => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('hackpilot_gemini_key') || '');
  const [name, setName] = useState(profile?.name || "");
  const [skillsInput, setSkillsInput] = useState(toSkillsInput(profile));
  const [interest, setInterest] = useState(profile?.interest || "");
  const [vibe, setVibe] = useState(profile?.vibe || "");
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideas, setIdeas] = useState<IdeaSuggestion[]>([]);
  const [discordWebhook, setDiscordWebhook] = useState(localStorage.getItem("hackpilot_discord_webhook") || "");
  const [discordHandle, setDiscordHandle] = useState("");
  const [lookingFor, setLookingFor] = useState("");
  const [availability, setAvailability] = useState("");
  const [discordPosting, setDiscordPosting] = useState(false);
  const [discordPreview, setDiscordPreview] = useState("");

  const saveGeminiKey = () => {
    localStorage.setItem('hackpilot_gemini_key', geminiKey);
    toast("Gemini API Key saved!", "success");
  };

  const buildProfile = (): OnboardingProfile => ({
    hackathonId: profile?.hackathonId || "",
    name: name.trim(),
    lookingForTeam: profile?.lookingForTeam ?? true,
    skills: parseSkills(skillsInput),
    interest: interest.trim(),
    vibe: vibe.trim(),
    discordUsername: profile?.discordUsername || "",
    anonymousInMatching: profile?.anonymousInMatching ?? false,
    showDiscordWhenAnonymous: profile?.showDiscordWhenAnonymous ?? true,
  });

  const ensureValidProfile = (nextProfile: OnboardingProfile) => {
    if (!nextProfile.name || !nextProfile.interest || !nextProfile.hackathonId || nextProfile.skills.length === 0) {
      toast("Fill Name, Hackathon, Skills, and Interest first.", "warn");
      return false;
    }
    if (nextProfile.lookingForTeam && !nextProfile.vibe) {
      toast("Vibe is required while you are seeking a team.", "warn");
      return false;
    }
    return true;
  };

  const saveProfile = async () => {
    const nextProfile = buildProfile();
    if (!ensureValidProfile(nextProfile)) return;
    try {
      await apiFetch("/api/profile/upsert", {
        method: "POST",
        body: JSON.stringify({
          room_id: roomCode,
          name: nextProfile.name,
          skills: nextProfile.skills,
          interest: nextProfile.interest,
          vibe: nextProfile.vibe,
        }),
      });
      if (nextProfile.lookingForTeam) {
        await apiFetch("/api/matchmaking/enroll", {
          method: "POST",
          body: JSON.stringify({
            room_id: roomCode,
            hackathon_id: nextProfile.hackathonId || "default",
            name: nextProfile.name,
            skills: nextProfile.skills,
            interest: nextProfile.interest,
            vibe: nextProfile.vibe,
            discord_username: nextProfile.discordUsername || undefined,
            anonymous_in_matching: nextProfile.anonymousInMatching,
            show_discord_when_anonymous: nextProfile.showDiscordWhenAnonymous,
          }),
        });
      }
      localStorage.setItem("hb_profile", JSON.stringify(nextProfile));
      onProfileChange(nextProfile);
      toast("Onboarding profile saved.", "success");
    } catch {
      toast("Couldn't save profile to backend.", "warn");
    }
  };

  const generateIdeas = async () => {
    const nextProfile = buildProfile();
    if (!ensureValidProfile(nextProfile)) return;
    setIdeaLoading(true);
    try {
      const response = await apiFetch<{ ideas?: IdeaSuggestion[] }>("/api/profile/ideas", {
        method: "POST",
        body: JSON.stringify({
          room_id: roomCode,
          name: nextProfile.name,
          skills: nextProfile.skills,
          interest: nextProfile.interest,
          vibe: nextProfile.vibe,
          count: 5,
        }),
      });
      const nextIdeas = (response.ideas || []).filter((idea) => idea?.title && idea?.pitch);
      setIdeas(nextIdeas);
      if (nextIdeas.length === 0) {
        toast("No ideas returned. Try adjusting onboarding fields.", "warn");
      } else {
        toast("Fresh project ideas generated.");
      }
    } catch {
      toast("Failed to generate ideas.", "error");
    } finally {
      setIdeaLoading(false);
    }
  };

  const postTeam8s = async () => {
    const nextProfile = buildProfile();
    if (!ensureValidProfile(nextProfile)) return;
    setDiscordPosting(true);
    localStorage.setItem("hackpilot_discord_webhook", discordWebhook.trim());
    try {
      const response = await apiFetch<{ posted?: boolean; preview?: string; error?: string }>("/api/discord/team8s", {
        method: "POST",
        body: JSON.stringify({
          room_id: roomCode,
          name: nextProfile.name,
          skills: nextProfile.skills,
          interest: nextProfile.interest,
          vibe: nextProfile.vibe,
          discord_handle: discordHandle.trim() || undefined,
          looking_for: lookingFor.trim() || undefined,
          availability: availability.trim() || undefined,
          webhook_url: discordWebhook.trim() || undefined,
        }),
      });
      setDiscordPreview(response.preview || "");
      if (response.posted) {
        toast("Posted to Discord teammate finder.", "success");
      } else if (response.error) {
        toast(response.error, "warn");
      } else {
        toast("Generated Team8s post preview. Add webhook URL to auto-post.", "warn");
      }
    } catch {
      toast("Failed to send Team8s post.", "error");
    } finally {
      setDiscordPosting(false);
    }
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
          <h2 className="text-[18px] font-semibold text-white mb-2">Onboarding profile</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Keep your Name, Skills, Interest, and Vibe updated so HackBuddy can profile you and give stronger idea suggestions.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={skillsInput}
              onChange={(event) => setSkillsInput(event.target.value)}
              placeholder="Skills (comma separated)"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              placeholder="Interest"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={vibe}
              onChange={(event) => setVibe(event.target.value)}
              placeholder="Vibe"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <div className="flex gap-3">
              <button
                onClick={saveProfile}
                className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.1)]"
              >
                Save profile
              </button>
              <button
                onClick={generateIdeas}
                disabled={ideaLoading}
                className="bg-white/[0.05] border border-white/[0.08] text-white text-[14px] font-medium px-5 py-3 rounded-xl transition-all disabled:opacity-50"
              >
                {ideaLoading ? "Generating…" : "Generate ideas"}
              </button>
            </div>
          </div>
          {ideas.length > 0 && (
            <div className="mt-4 bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
              {ideas.map((idea, index) => (
                <div key={`${idea.title}-${index}`} className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.02]">
                  <p className="text-white text-[14px] font-semibold">{idea.title}</p>
                  <p className="text-[#d4d4d8] text-[13px] mt-1">{idea.pitch}</p>
                  <p className="text-[#71717a] text-[12px] mt-2">{idea.fit}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">Discord Team8s bot</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Generate or post a teammate-finder message from your onboarding profile.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
            <input
              value={discordWebhook}
              onChange={(event) => setDiscordWebhook(event.target.value)}
              placeholder="Discord webhook URL (optional for auto-post)"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={discordHandle}
              onChange={(event) => setDiscordHandle(event.target.value)}
              placeholder="Discord handle (optional)"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={lookingFor}
              onChange={(event) => setLookingFor(event.target.value)}
              placeholder="Looking for (optional)"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
              placeholder="Availability (optional)"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <button
              onClick={postTeam8s}
              disabled={discordPosting}
              className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] disabled:opacity-50"
            >
              {discordPosting ? "Posting…" : "Post Team8s"}
            </button>
          </div>
          {discordPreview && (
            <pre className="mt-4 whitespace-pre-wrap bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-4 text-[12px] text-[#d4d4d8]">
              {discordPreview}
            </pre>
          )}
        </section>

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
