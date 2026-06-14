import { useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { AuthUser, OnboardingProfile } from "../hackbuddyTypes";

const parseSkills = (skillsInput: string) =>
  skillsInput
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

export default function EntryScreen({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: AuthUser, profile: OnboardingProfile) => void;
}) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hackathonId, setHackathonId] = useState("default");
  const [skillsInput, setSkillsInput] = useState("");
  const [interest, setInterest] = useState("");
  const [vibe, setVibe] = useState("");

  const buildProfile = (nextUser?: AuthUser): OnboardingProfile => ({
    hackathonId: nextUser?.hackathon_id || hackathonId.trim() || "default",
    name: nextUser?.username || username.trim(),
    skills: nextUser?.skills || parseSkills(skillsInput),
    interest: nextUser?.interest || interest.trim(),
    vibe: nextUser?.vibe || vibe.trim(),
  });

  const validateSignup = () => {
    const profile = buildProfile();
    if (!profile.name) return "Username is required.";
    if (!password.trim()) return "Password is required.";
    if (profile.skills.length === 0) return "Add at least one skill.";
    if (!profile.interest) return "Interest is required.";
    if (!profile.vibe) return "Vibe is required.";
    return "";
  };

  const handleSignup = async () => {
    const validationError = validateSignup();
    if (validationError) {
      setErr(validationError);
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
          hackathon_id: hackathonId.trim() || "default",
          skills: parseSkills(skillsInput),
          interest: interest.trim(),
          vibe: vibe.trim(),
        }),
      });
      localStorage.setItem("hb_auth_token", response.token);
      localStorage.setItem("hb_profile", JSON.stringify(buildProfile(response.user)));
      onAuthenticated(response.token, response.user, buildProfile(response.user));
    } catch {
      setErr("Signup failed. Try a different username.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
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
      localStorage.setItem("hb_auth_token", response.token);
      localStorage.setItem("hb_profile", JSON.stringify(buildProfile(response.user)));
      onAuthenticated(response.token, response.user, buildProfile(response.user));
    } catch {
      setErr("Login failed. Check username/password.");
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = mode === "signup" ? "Create account" : "Login";

  return (
    <div className="min-h-screen bg-[#08090a] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[50%] translate-x-[-50%] w-[600px] h-[600px] bg-[#3b82f6]/[0.08] rounded-full blur-[120px] pointer-events-none" />
      <div className="w-full max-w-[420px] relative z-10">
        <div className="mb-10 text-center">
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
            Sign in first. Team matchmaking happens before project rooms are created.
          </p>
        </div>

        <div className="bg-[#0f1012]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 flex flex-col gap-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_50px_rgba(0,0,0,0.5)]">
          <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">
            {mode === "signup" ? "Create your account + NSIV" : "Login"}
          </label>

          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setErr("");
            }}
            placeholder="Username"
            className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErr("");
            }}
            placeholder="Password"
            className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
          />

          {mode === "signup" && (
            <>
              <input
                value={hackathonId}
                onChange={(e) => {
                  setHackathonId(e.target.value);
                  setErr("");
                }}
                placeholder="Hackathon ID (e.g. jamhacks26)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
              />
              <input
                value={skillsInput}
                onChange={(e) => {
                  setSkillsInput(e.target.value);
                  setErr("");
                }}
                placeholder="Skills (comma separated)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
              />
              <input
                value={interest}
                onChange={(e) => {
                  setInterest(e.target.value);
                  setErr("");
                }}
                placeholder="Interest (what you want to build)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
              />
              <input
                value={vibe}
                onChange={(e) => {
                  setVibe(e.target.value);
                  setErr("");
                }}
                placeholder="Vibe (e.g. chill, competitive, experimental)"
                className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#52525b] outline-none transition-all"
              />
            </>
          )}

          <button
            onClick={() => void (mode === "signup" ? handleSignup() : handleLogin())}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-[#09090b] font-semibold text-[14px] py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] disabled:opacity-50"
          >
            {loading ? <span className="w-4 h-4 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" /> : null}
            {actionLabel}
          </button>

          <button
            onClick={() => {
              setMode((currentMode) => (currentMode === "signup" ? "login" : "signup"));
              setErr("");
            }}
            className="text-[13px] text-[#a1a1aa] border border-white/[0.08] rounded-xl py-2.5 hover:bg-white/[0.03]"
          >
            {mode === "signup" ? "Already have an account? Login" : "Need an account? Sign up"}
          </button>

          {err && <p className="text-[#ef4444] text-[13px]">{err}</p>}
        </div>
      </div>
    </div>
  );
}
