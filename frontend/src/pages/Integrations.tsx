import { useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { OnboardingProfile, ToastFn } from "../hackbuddyTypes";

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
  const [name, setName] = useState(profile?.name || "");
  const [skillsInput, setSkillsInput] = useState(toSkillsInput(profile));
  const [interest, setInterest] = useState(profile?.interest || "");
  const [vibe, setVibe] = useState(profile?.vibe || "");
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideas, setIdeas] = useState<IdeaSuggestion[]>([]);

  useEffect(() => {
    setName(profile?.name || "");
    setSkillsInput(toSkillsInput(profile));
    setInterest(profile?.interest || "");
    setVibe(profile?.vibe || "");
  }, [profile]);

  const buildProfile = (): OnboardingProfile => ({
    hackathonId: profile?.hackathonId || "",
    name: name.trim(),
    lookingForTeam: profile?.lookingForTeam ?? false,
    skills: parseSkills(skillsInput),
    interest: interest.trim(),
    vibe: vibe.trim(),
    discordUsername: profile?.discordUsername || "",
  });

  const ensureValidProfile = (nextProfile: OnboardingProfile) => {
    if (!nextProfile.name || !nextProfile.interest || !nextProfile.vibe || nextProfile.skills.length === 0) {
      toast("Fill Name, Skills, Interest, and Vibe first.", "warn");
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

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-[#08090a]">
      <div data-tour="integrations-workspace" className="max-w-2xl mx-auto flex flex-col gap-10">
        <section>
          <h2 className="text-[18px] font-semibold text-white mb-2">Profile + idea generator</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Keep your Name, Skills, Interest, and Vibe updated so HackBuddy can profile your team style and generate stronger project ideas.
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
          <h2 className="text-[18px] font-semibold text-white mb-2">API key security</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            HackPilot now uses server-managed API keys only. Keys are configured in backend environment variables and never stored in browser localStorage.
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 text-[13px] text-[#d4d4d8] leading-relaxed">
            <p>• Frontend requests no longer send custom key headers.</p>
            <p className="mt-2">• AI keys stay on the backend and can be rotated without client updates.</p>
            <p className="mt-2">• This reduces accidental key leakage from browser storage or screenshots.</p>
          </div>
        </section>
      </div>
    </div>
  );
}