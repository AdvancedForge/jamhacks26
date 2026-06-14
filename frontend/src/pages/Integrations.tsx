import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { OnboardingProfile, ToastFn } from "../hackbuddyTypes";
import {
  AI_PROVIDER_PRESETS,
  DEFAULT_CHAT_MODELS,
  clearAiConfig,
  parseModelList,
  readAiConfig,
  saveAiConfig,
  stringifyModelList,
  type AiProviderPreset,
} from "../aiConfig";

type IdeaSuggestion = {
  title: string;
  pitch: string;
  fit: string;
};
type RoomAiConfigResponse = {
  ok?: boolean;
  config?: {
    configured?: boolean;
    has_api_key?: boolean;
    request_url?: string;
    models?: string[];
    provider_preset?: string;
  };
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

  const existingAiConfig = useMemo(() => readAiConfig(), []);
  const [providerPreset, setProviderPreset] = useState<AiProviderPreset>(
    existingAiConfig?.providerPreset || "gemini",
  );
  const [requestUrl, setRequestUrl] = useState(existingAiConfig?.requestUrl || AI_PROVIDER_PRESETS[0].requestUrl);
  const [apiKey, setApiKey] = useState(existingAiConfig?.apiKey || "");
  const [modelsInput, setModelsInput] = useState(
    stringifyModelList(existingAiConfig?.models || DEFAULT_CHAT_MODELS),
  );
  const [isAiConfigLoading, setIsAiConfigLoading] = useState(true);
  const [isBackendAiConfigSaved, setIsBackendAiConfigSaved] = useState(false);

  useEffect(() => {
    setName(profile?.name || "");
    setSkillsInput(toSkillsInput(profile));
    setInterest(profile?.interest || "");
    setVibe(profile?.vibe || "");
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    const loadBackendAiConfig = async () => {
      if (!roomCode) {
        if (!cancelled) {
          setIsAiConfigLoading(false);
          setIsBackendAiConfigSaved(false);
        }
        return;
      }
      setIsAiConfigLoading(true);
      try {
        const response = await apiFetch<RoomAiConfigResponse>(
          `/api/ai-config/${encodeURIComponent(roomCode)}`,
        );
        if (cancelled) return;
        const config = response.config;
        setIsBackendAiConfigSaved(Boolean(config?.has_api_key));
        if (!config?.configured) return;
        if (typeof config.request_url === "string" && config.request_url.trim()) {
          setRequestUrl(config.request_url.trim());
        }
        if (Array.isArray(config.models) && config.models.length > 0) {
          setModelsInput(
            stringifyModelList(
              config.models.map((modelName) => String(modelName).trim()).filter(Boolean),
            ),
          );
        }
        const preset = config.provider_preset;
        if (
          preset === "gemini" ||
          preset === "openai" ||
          preset === "openrouter" ||
          preset === "groq" ||
          preset === "custom"
        ) {
          setProviderPreset(preset);
        }
        setApiKey("");
      } catch {
        if (!cancelled) setIsBackendAiConfigSaved(false);
      } finally {
        if (!cancelled) setIsAiConfigLoading(false);
      }
    };
    void loadBackendAiConfig();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

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

  const applyProviderPreset = (presetId: AiProviderPreset) => {
    setProviderPreset(presetId);
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    if (preset.requestUrl) setRequestUrl(preset.requestUrl);
    if (!modelsInput.trim() || modelsInput === stringifyModelList(DEFAULT_CHAT_MODELS)) {
      setModelsInput(stringifyModelList(preset.models));
    }
  };

  const saveAiProviderConfig = async () => {
    const models = parseModelList(modelsInput);
    if (!roomCode) {
      toast("Join a room before saving AI config.", "warn");
      return;
    }
    if (!apiKey.trim()) {
      toast("Enter an API key to enable custom AI provider routing.", "warn");
      return;
    }
    if (!requestUrl.trim()) {
      toast("Enter a request URL for your provider.", "warn");
      return;
    }
    if (!/^https?:\/\//i.test(requestUrl.trim())) {
      toast("Request URL must start with http:// or https://.", "warn");
      return;
    }
    if (models.length === 0) {
      toast("Provide at least one model name.", "warn");
      return;
    }
    try {
      await apiFetch(`/api/ai-config/${encodeURIComponent(roomCode)}`, {
        method: "PUT",
        body: JSON.stringify({
          api_key: apiKey.trim(),
          request_url: requestUrl.trim(),
          models,
          provider_preset: providerPreset,
        }),
      });
      saveAiConfig({
        apiKey: "",
        requestUrl: requestUrl.trim(),
        models,
        providerPreset,
      });
      setApiKey("");
      setIsBackendAiConfigSaved(true);
      toast("Custom AI provider saved on backend for this room.", "success");
    } catch {
      toast("Couldn't save custom AI config to backend.", "error");
    }
  };

  const clearAiProviderConfig = async () => {
    if (roomCode) {
      try {
        await apiFetch(`/api/ai-config/${encodeURIComponent(roomCode)}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore backend clear failures and still clear local session overrides.
      }
    }
    clearAiConfig();
    setApiKey("");
    setProviderPreset("gemini");
    setRequestUrl(AI_PROVIDER_PRESETS[0].requestUrl);
    setModelsInput(stringifyModelList(DEFAULT_CHAT_MODELS));
    setIsBackendAiConfigSaved(false);
    toast("Custom AI provider cleared. Shared backend key limits now apply.", "warn");
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-[#08090a]">
      <div data-tour="integrations-workspace" className="max-w-3xl mx-auto flex flex-col gap-10">
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
            <div className="flex gap-3 flex-wrap">
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
          <h2 className="text-[18px] font-semibold text-white mb-2">Custom AI provider (backend-secured)</h2>
          <p className="text-[14px] text-[#52525b] mb-5 leading-relaxed">
            Bring your own key and endpoint. The API key is stored on the backend per room and is not returned to the browser after save.
          </p>
          <p className="text-[12px] text-[#71717a] mb-4">
            Backend key status: {isAiConfigLoading ? "Checking..." : isBackendAiConfigSaved ? "Saved" : "Not saved"}
          </p>
          <div className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
            <label className="text-[12px] text-[#a1a1aa]">Provider preset</label>
            <select
              value={providerPreset}
              onChange={(event) => applyProviderPreset(event.target.value as AiProviderPreset)}
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white outline-none transition-all"
            >
              {AI_PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id} className="bg-[#0f1012] text-white">
                  {preset.label}
                </option>
              ))}
            </select>
            <input
              value={requestUrl}
              onChange={(event) => setRequestUrl(event.target.value)}
              placeholder="https://.../chat/completions"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Provider API key"
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
            />
            <textarea
              value={modelsInput}
              onChange={(event) => setModelsInput(event.target.value)}
              placeholder="comma-separated models"
              rows={3}
              className="bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all resize-none"
            />
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={saveAiProviderConfig}
                className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.1)]"
              >
                Save custom AI config
              </button>
              <button
                onClick={clearAiProviderConfig}
                className="bg-white/[0.05] border border-white/[0.08] text-white text-[14px] font-medium px-5 py-3 rounded-xl transition-all"
              >
                Clear custom config
              </button>
            </div>
          </div>
          <div className="mt-4 bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5 text-[13px] text-[#d4d4d8] leading-relaxed">
            <p>• If no custom key is set, shared backend AI key limits apply.</p>
            <p className="mt-2">• To avoid provider schema mismatches, use OpenAI-compatible chat completion URLs.</p>
            <p className="mt-2">• Model order defaults: 3.1 Flash Lite, 2.5 Flash, then the two Gemmas.</p>
          </div>
        </section>
      </div>
    </div>
  );
}