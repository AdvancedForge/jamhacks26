export type AiProviderPreset = "gemini" | "openai" | "openrouter" | "groq" | "custom";

export type AiConfig = {
  apiKey: string;
  requestUrl: string;
  models: string[];
  providerPreset: AiProviderPreset;
};

export const AI_CONFIG_STORAGE_KEY = "hb_ai_config_session";
export const AI_CONFIG_UPDATED_EVENT = "hb-ai-config-updated";

export const DEFAULT_CHAT_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
];

export const AI_PROVIDER_PRESETS: Array<{
  id: AiProviderPreset;
  label: string;
  requestUrl: string;
  models: string[];
}> = [
  {
    id: "gemini",
    label: "Google Gemini (OpenAI-compatible endpoint)",
    requestUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: DEFAULT_CHAT_MODELS,
  },
  {
    id: "openai",
    label: "OpenAI",
    requestUrl: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    requestUrl: "https://openrouter.ai/api/v1/chat/completions",
    models: ["openai/gpt-4.1-mini", "anthropic/claude-3.7-sonnet", "google/gemini-2.5-flash"],
  },
  {
    id: "groq",
    label: "Groq",
    requestUrl: "https://api.groq.com/openai/v1/chat/completions",
    models: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "gemma2-9b-it"],
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible URL",
    requestUrl: "",
    models: DEFAULT_CHAT_MODELS,
  },
];

export const parseModelList = (raw: string): string[] => {
  const values = raw
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  values.forEach((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(value);
  });
  return unique;
};

export const stringifyModelList = (models: string[]): string => models.join(", ");

export const readAiConfig = (): AiConfig | null => {
  try {
    const raw = sessionStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    if (!parsed || typeof parsed !== "object") return null;
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    const requestUrl = typeof parsed.requestUrl === "string" ? parsed.requestUrl.trim() : "";
    const providerPreset: AiProviderPreset =
      parsed.providerPreset === "gemini" ||
      parsed.providerPreset === "openai" ||
      parsed.providerPreset === "openrouter" ||
      parsed.providerPreset === "groq" ||
      parsed.providerPreset === "custom"
        ? parsed.providerPreset
        : "custom";
    const models = Array.isArray(parsed.models)
      ? parsed.models.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (!apiKey || !requestUrl || models.length === 0) return null;
    return { apiKey, requestUrl, models, providerPreset };
  } catch {
    return null;
  }
};

export const saveAiConfig = (config: AiConfig): void => {
  sessionStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(AI_CONFIG_UPDATED_EVENT));
};

export const clearAiConfig = (): void => {
  sessionStorage.removeItem(AI_CONFIG_STORAGE_KEY);
  window.dispatchEvent(new Event(AI_CONFIG_UPDATED_EVENT));
};

export const getAiHeaders = (): Record<string, string> => {
  const config = readAiConfig();
  if (!config) return {};
  return {
    "X-AI-API-Key": config.apiKey,
    "X-AI-Request-URL": config.requestUrl,
    "X-AI-Models": config.models.join(","),
  };
};
