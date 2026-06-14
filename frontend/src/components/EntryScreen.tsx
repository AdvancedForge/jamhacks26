import { useMemo, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { AuthUser, OnboardingProfile } from "../hackbuddyTypes";

type EntryMode = "landing" | "signin" | "signup" | "create-room" | "join-room";

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
  const [mode, setMode] = useState<EntryMode>("landing");
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
    if (mode === "signup") return "Sign up for teammaking";
    if (mode === "create-room") return "Create room";
    if (mode === "join-room") return "Join room";
    return "";
  }, [mode]);

  const resetToLanding = () => {
    setMode("landing");
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
      onEnterRoom(normalizedRoomCode, displayName.trim() || "You");
    } catch {
      setErr("Room not found. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090a] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[50%] translate-x-[-50%] w-[600px] h-[600px] bg-[#3b82f6]/[0.08] rounded-full blur-[120px] pointer-events-none" />
      <div className="w-full max-w-[460px] relative z-10">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
                <rect x="5" y="8" width="7" height="12" rx="1.5" fill="#ffffff" fillOpacity=".4" />
                <rect x="14" y="5" width="9" height="7" rx="1.5" fill="#ffffff" />
                <rect x="14" y="14" width="9" height="6" rx="1.5" fill="#ffffff" fillOpacity=".3" />
              </svg>
            </div>
            <span className="text-white text-2xl font-semibold tracking-tight">
              Hack<span className="text-[#a1a1aa]">Buddy</span>
            </span>
          </div>
          <p className="text-[#71717a] text-[15px] leading-relaxed">
            Sign in, or go directly into a room. Signup is for people actively building a team.
          </p>
        </div>

        <div className="bg-[#0f1012]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-7 flex flex-col gap-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_50px_rgba(0,0,0,0.5)]">
          {mode === "landing" && (
            <>
              <button
                onClick={() => {
                  setMode("signin");
                  setErr("");
                }}
                className="w-full bg-white text-[#09090b] font-semibold text-[14px] py-3 rounded-xl"
              >
                Sign in
              </button>
              <button
                onClick={() => {
                  setMode("signup");
                  setErr("");
                }}
                className="w-full bg-white/[0.05] border border-white/[0.08] text-white text-[14px] py-3 rounded-xl"
              >
                Sign up for teammaking
              </button>
              <div className="h-px bg-white/[0.08] my-1" />
              <button
                onClick={() => {
                  setMode("create-room");
                  setErr("");
                }}
                className="w-full bg-white/[0.05] border border-white/[0.08] text-white text-[14px] py-3 rounded-xl"
              >
                Create room now
              </button>
              <button
                onClick={() => {
                  setMode("join-room");
                  setErr("");
                }}
                className="w-full bg-white/[0.05] border border-white/[0.08] text-white text-[14px] py-3 rounded-xl"
              >
                Join room by code
              </button>
            </>
          )}

          {mode === "signin" && (
            <>
              <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">Sign in</label>
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErr("");
                }}
                placeholder="Username"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErr("");
                }}
                placeholder="Password"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
            </>
          )}

          {mode === "signup" && (
            <>
              <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">Signup (teammaking only)</label>
              <p className="text-[12px] text-[#a1a1aa] -mt-1">
                Use this only if you want to find teammates and invite collaborators.
              </p>
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErr("");
                }}
                placeholder="Username"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErr("");
                }}
                placeholder="Password"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                value={hackathonId}
                onChange={(event) => {
                  setHackathonId(event.target.value);
                  setErr("");
                }}
                placeholder="Hackathon ID (e.g. jamhacks26)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                value={skillsInput}
                onChange={(event) => {
                  setSkillsInput(event.target.value);
                  setErr("");
                }}
                placeholder="Skills (comma separated)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                value={interest}
                onChange={(event) => {
                  setInterest(event.target.value);
                  setErr("");
                }}
                placeholder="Interest (what you want to build)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                value={vibe}
                onChange={(event) => {
                  setVibe(event.target.value);
                  setErr("");
                }}
                placeholder="Vibe"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              <input
                value={discordUsername}
                onChange={(event) => {
                  setDiscordUsername(event.target.value);
                  setErr("");
                }}
                placeholder="Discord username (optional)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
            </>
          )}

          {(mode === "create-room" || mode === "join-room") && (
            <>
              <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">
                {mode === "create-room" ? "Create room" : "Join room"}
              </label>
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setErr("");
                }}
                placeholder="Display name (optional)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
              />
              {mode === "join-room" && (
                <input
                  value={roomCodeInput}
                  onChange={(event) => {
                    setRoomCodeInput(event.target.value);
                    setErr("");
                  }}
                  placeholder="Room code"
                  className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none"
                />
              )}
            </>
          )}

          {mode !== "landing" && (
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
              className="w-full flex items-center justify-center gap-2 bg-white text-[#09090b] font-semibold text-[14px] py-3 rounded-xl disabled:opacity-50"
            >
              {loading ? <span className="w-4 h-4 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" /> : null}
              {actionLabel}
            </button>
          )}

          {mode !== "landing" && (
            <button
              onClick={resetToLanding}
              className="text-[13px] text-[#a1a1aa] border border-white/[0.08] rounded-xl py-2.5 hover:bg-white/[0.03]"
            >
              Back
            </button>
          )}

          {err && <p className="text-[#ef4444] text-[13px]">{err}</p>}
        </div>
      </div>
    </div>
  );
}
