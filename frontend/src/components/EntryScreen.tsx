import { useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import { genRoomCode } from "../hackbuddyUtils";
import type { OnboardingProfile } from "../hackbuddyTypes";

const parseSkills = (skillsInput: string) =>
  skillsInput
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

export default function EntryScreen({ onEnter }: { onEnter: (code: string, profile: OnboardingProfile) => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [interest, setInterest] = useState("");
  const [vibe, setVibe] = useState("");

  const buildProfile = (): OnboardingProfile => ({
    name: name.trim(),
    skills: parseSkills(skillsInput),
    interest: interest.trim(),
    vibe: vibe.trim(),
  });

  const validateProfile = (profile: OnboardingProfile) => {
    if (!profile.name) return "Name is required.";
    if (profile.skills.length === 0) return "Add at least one skill.";
    if (!profile.interest) return "Interest is required.";
    if (!profile.vibe) return "Vibe is required.";
    return "";
  };

  const saveProfile = async (roomId: string, profile: OnboardingProfile) => {
    localStorage.setItem("hb_profile", JSON.stringify(profile));
    try {
      await apiFetch("/api/profile/upsert", {
        method: "POST",
        body: JSON.stringify({
          room_id: roomId,
          name: profile.name,
          skills: profile.skills,
          interest: profile.interest,
          vibe: profile.vibe,
        }),
      });
    } catch {
      // non-blocking fallback: profile still stored locally
    }
  };

  const handleCreate = async () => {
    const profile = buildProfile();
    const validationError = validateProfile(profile);
    if (validationError) {
      setErr(validationError);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch<{ room_id: string }>("/api/room/create", { method: "POST" });
      const roomId = data.room_id;
      localStorage.setItem("hb_room", roomId);
      await saveProfile(roomId, profile);
      onEnter(roomId, profile);
    } catch {
      const roomId = genRoomCode();
      localStorage.setItem("hb_room", roomId);
      await saveProfile(roomId, profile);
      onEnter(roomId, profile);
    } finally {
      setLoading(false);
    }
  };
  const handleJoin = async () => {
    const profile = buildProfile();
    const validationError = validateProfile(profile);
    if (validationError) {
      setErr(validationError);
      return;
    }
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setErr("Enter at least 4 characters.");
      return;
    }
    localStorage.setItem("hb_room", trimmed);
    await saveProfile(trimmed, profile);
    onEnter(trimmed, profile);
  };

  return (
    <div className="min-h-screen bg-[#08090a] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[50%] translate-x-[-50%] w-[600px] h-[600px] bg-[#3b82f6]/[0.08] rounded-full blur-[120px] pointer-events-none" />
      <div className="w-full max-w-[400px] relative z-10">
        <div className="mb-12 text-center">
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
            Your hackathon co-pilot.<br />
            One tab, the whole 36 hours.
          </p>
        </div>

        <div className="bg-[#0f1012]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 flex flex-col gap-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="grid gap-3">
            <label className="text-[11px] uppercase tracking-wider text-[#52525b] font-medium">Onboarding profile</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErr("");
              }}
              placeholder="Name"
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
          </div>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-[#09090b] font-semibold text-[14px] py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-[#09090b]/20 border-t-[#09090b] rounded-full animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 8 1.5Z" />
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
              onChange={(e) => {
                setCode(e.target.value);
                setErr("");
              }}
              onKeyDown={(e) => e.key === "Enter" && void handleJoin()}
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

        <p className="text-center text-[#3f3f46] text-[13px] mt-6">No account needed. Share the code with your team.</p>
      </div>
    </div>
  );
}
