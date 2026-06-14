import { useMemo, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { AuthUser, OnboardingProfile } from "../hackbuddyTypes";
type EntryMode = "welcome" | "signin" | "signup" | "create-room" | "join-room";

const parseSkills = (skillsInput: string) =>
  skillsInput
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

const profileFromUser = (user: AuthUser): OnboardingProfile => ({
  hackathonId: (user.hackathon_id || "").trim(),
  name: (user.username || "").trim(),
  lookingForTeam: Boolean(user.looking_for_team),
  skills: Array.isArray(user.skills) ? user.skills.map((skill) => String(skill).trim()).filter(Boolean) : [],
  interest: (user.interest || "").trim(),
  vibe: (user.vibe || "").trim(),
  discordUsername: (user.discord_username || "").trim(),
});

export default function EntryScreen({
  onAuthenticated,
  onEnterRoom,
}: {
  onAuthenticated: (token: string, user: AuthUser, profile: OnboardingProfile) => void;
  onEnterRoom: (roomCode: string, displayName: string) => void;
}) {
  const [mode, setMode] = useState<EntryMode>("welcome");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hackathonId, setHackathonId] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [interest, setInterest] = useState("");
  const [vibe, setVibe] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");

  const actionLabel = useMemo(() => {
    if (mode === "signin") return "Sign in";
    if (mode === "signup") return "Create account";
    if (mode === "create-room") return "Create room";
    if (mode === "join-room") return "Join room";
    return "";
  }, [mode]);
  const modeTitle = useMemo(() => {
    if (mode === "signin") return "Sign in to your account";
    if (mode === "signup") return "Sign up for team matching";
    if (mode === "create-room") return "Create a new room";
    if (mode === "join-room") return "Join an existing room";
    return "";
  }, [mode]);

  const modeDescription = useMemo(() => {
    if (mode === "signin") return "Continue with your existing HackPilot account.";
    if (mode === "signup") return "Only needed if you want teammate matching and invites.";
    if (mode === "create-room") return "Start a shared workspace and invite your team.";
    if (mode === "join-room") return "Paste a room code from a teammate to continue.";
    return "";
  }, [mode]);

  const openMode = (nextMode: EntryMode) => {
    setMode(nextMode);
    setErr("");
  };

  const resetToWelcome = () => {
    setMode("welcome");
    setErr("");
  };

  const handleSignIn = async () => {
    if (!username.trim() || !password.trim()) {
      setErr("Enter username and password.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const response = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
        }),
      });
      const profile = profileFromUser(response.user);
      localStorage.setItem("hb_auth_token", response.token);
      localStorage.setItem("hb_auth_user", JSON.stringify(response.user));
      localStorage.setItem("hb_profile", JSON.stringify(profile));
      onAuthenticated(response.token, response.user, profile);
      if (response.user.room_id) {
        onEnterRoom(String(response.user.room_id), response.user.username || "You");
      }
    } catch {
      setErr("Sign in failed. Check username/password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    const skills = parseSkills(skillsInput);
    if (!username.trim() || !password.trim()) {
      setErr("Username and password are required.");
      return;
    }
    if (!hackathonId.trim()) {
      setErr("Hackathon is required.");
      return;
    }
    if (skills.length === 0 || !interest.trim() || !vibe.trim()) {
      setErr("Skills, interest, and vibe are required for teammaking signup.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const response = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          hackathon_id: hackathonId.trim(),
          skills,
          interest: interest.trim(),
          vibe: vibe.trim(),
          discord_username: discordUsername.trim() || undefined,
        }),
      });
      const profile = profileFromUser(response.user);
      localStorage.setItem("hb_auth_token", response.token);
      localStorage.setItem("hb_auth_user", JSON.stringify(response.user));
      localStorage.setItem("hb_profile", JSON.stringify(profile));
      onAuthenticated(response.token, response.user, profile);
    } catch {
      setErr("Signup failed. Try a different username.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRoom = async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await apiFetch<{ room_id: string }>("/api/room/create", { method: "POST" });
      onEnterRoom(response.room_id, displayName.trim() || "You");
    } catch {
      setErr("Could not create a room right now.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    const normalizedRoomCode = roomCodeInput.trim().toUpperCase();
    if (!normalizedRoomCode) {
      setErr("Enter a room code.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      await apiFetch("/api/room/join", {
        method: "POST",
        body: JSON.stringify({ room_id: normalizedRoomCode }),
      });
      onEnterRoom(normalizedRoomCode, "");
    } catch {
      setErr("Room not found. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090a] px-4 py-10 text-white">
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-[1.2fr_1fr]">
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1012]/70 p-7 md:p-9">
          <div className="pointer-events-none absolute -top-20 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#3b82f6]/20 blur-[80px]" />
          <div className="relative">
            <div className="inline-flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05]">
                <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
                  <rect x="5" y="8" width="7" height="12" rx="1.5" fill="#ffffff" fillOpacity=".4" />
                  <rect x="14" y="5" width="9" height="7" rx="1.5" fill="#ffffff" />
                  <rect x="14" y="14" width="9" height="6" rx="1.5" fill="#ffffff" fillOpacity=".3" />
                </svg>
              </div>
              <span className="text-xl font-semibold tracking-tight">HackPilot</span>
            </div>

            <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight md:text-[34px]">
              One room for your whole hackathon workflow.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#c4c4cc]">
              HackPilot keeps your team aligned with task planning, whiteboard-to-code generation, and
              HackBuddy AI support in one shared space.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <p className="text-[12px] font-medium text-white">Plan together</p>
                <p className="mt-1 text-[12px] text-[#a1a1aa]">Track work on a live Kanban board.</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <p className="text-[12px] font-medium text-white">Sketch ideas</p>
                <p className="mt-1 text-[12px] text-[#a1a1aa]">Use the whiteboard and generate starter code.</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <p className="text-[12px] font-medium text-white">Ship faster</p>
                <p className="mt-1 text-[12px] text-[#a1a1aa]">Share integrations and roadmap updates.</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-[#a1a1aa]">Quick start</p>
              <ol className="mt-2 space-y-1.5 text-[13px] text-[#e4e4e7]">
                <li>1. Sign in or continue as a guest.</li>
                <li>2. Create a room or join with a teammate’s code.</li>
                <li>3. Start planning and building together.</li>
              </ol>
            </div>
          </div>
        </section>

        <section className="flex h-full flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#0f1012]/80 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
          {mode === "welcome" ? (
            <>
              <div>
                <p className="text-lg font-semibold text-white">Get started</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#a1a1aa]">
                  Use an account for teammate matching, or jump directly into a room.
                </p>
              </div>

              <button
                onClick={() => openMode("signin")}
                className="w-full rounded-xl bg-white py-3 text-[14px] font-semibold text-[#09090b]"
              >
                Sign in
              </button>
              <button
                onClick={() => openMode("signup")}
                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] py-3 text-[14px] text-white"
              >
                Sign up for team matching
              </button>

              <div className="my-1 h-px bg-white/[0.08]" />

              <p className="text-[12px] uppercase tracking-wide text-[#71717a]">Continue as guest</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => openMode("create-room")}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-[13px] text-white"
                >
                  Create room
                </button>
                <button
                  onClick={() => openMode("join-room")}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-[13px] text-white"
                >
                  Join room
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-[16px] font-semibold text-white">{modeTitle}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#a1a1aa]">{modeDescription}</p>
              </div>

              {mode === "signin" && (
                <>
                  <input
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setErr("");
                    }}
                    placeholder="Username"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setErr("");
                    }}
                    placeholder="Password"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                </>
              )}
              {mode === "join-room" && (
                <input
                  value={roomCodeInput}
                  onChange={(event) => {
                    setRoomCodeInput(event.target.value);
                    setErr("");
                  }}
                  placeholder="Room code"
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                />
              )}

              {mode === "signup" && (
                <>
                  <input
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setErr("");
                    }}
                    placeholder="Username"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setErr("");
                    }}
                    placeholder="Password"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    value={hackathonId}
                    onChange={(event) => {
                      setHackathonId(event.target.value);
                      setErr("");
                    }}
                    placeholder="Hackathon ID (e.g. jamhacks26)"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    value={skillsInput}
                    onChange={(event) => {
                      setSkillsInput(event.target.value);
                      setErr("");
                    }}
                    placeholder="Skills (comma separated)"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    value={interest}
                    onChange={(event) => {
                      setInterest(event.target.value);
                      setErr("");
                    }}
                    placeholder="What do you want to build?"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    value={vibe}
                    onChange={(event) => {
                      setVibe(event.target.value);
                      setErr("");
                    }}
                    placeholder="Your vibe (e.g. chill, fast-paced)"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                  <input
                    value={discordUsername}
                    onChange={(event) => {
                      setDiscordUsername(event.target.value);
                      setErr("");
                    }}
                    placeholder="Discord username (optional)"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                </>
              )}

              {mode === "create-room" && (
                <>
                  <input
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      setErr("");
                    }}
                    placeholder="Display name (optional)"
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none focus:border-white/[0.2]"
                  />
                </>
              )}

              <button
                onClick={() => {
                  if (mode === "signin") {
                    void handleSignIn();
                    return;
                  }
                  if (mode === "signup") {
                    void handleSignUp();
                    return;
                  }
                  if (mode === "create-room") {
                    void handleCreateRoom();
                    return;
                  }
                  void handleJoinRoom();
                }}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-[14px] font-semibold text-[#09090b] disabled:opacity-50"
              >
                {loading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#09090b]/20 border-t-[#09090b]" />
                ) : null}
                {actionLabel}
              </button>
              <button
                onClick={resetToWelcome}
                className="rounded-xl border border-white/[0.1] py-2.5 text-[13px] text-[#a1a1aa] hover:bg-white/[0.03]"
              >
                Back
              </button>
            </>
          )}

          {err ? <p className="text-[13px] text-[#ef4444]">{err}</p> : null}
        </section>
      </div>
    </div>
  );
}
