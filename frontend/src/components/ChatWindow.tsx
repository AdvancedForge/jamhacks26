import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../hackbuddyTypes";

type ChatModelOption = {
  value: string;
  label: string;
};

const isHackBuddySender = (sender: string) => sender === "HackBuddy AI" || sender === "AI Whiteboard Assistant";

export const ChatWindow = ({
  roomCode,
  messages,
  onSendMessage,
  isAiThinking,
  selectedModel,
  modelOptions,
  onSelectModel,
}: {
  roomCode: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isAiThinking?: boolean;
  selectedModel: string;
  modelOptions: ChatModelOption[];
  onSelectModel: (modelName: string) => void;
}) => {
  const [input, setInput] = useState("");
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const selectedModelLabel = modelOptions.find((model) => model.value === selectedModel)?.label || selectedModel;

  useEffect(() => {
    if (!isModelModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsModelModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModelModalOpen]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input);
    setInput("");
  };

  const copyMessage = async (messageKey: string, message: string) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;
    try {
      await navigator.clipboard.writeText(trimmedMessage);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = trimmedMessage;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      document.body.removeChild(fallback);
    }

    setCopiedMessageKey(messageKey);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopiedMessageKey(null), 1200);
  };

  return (
    <div className="relative flex flex-col h-full bg-[#08090a] border-l border-white/[0.04]">
      <div className="p-4 border-b border-white/[0.04] flex items-center justify-between gap-2">
        <span className="font-bold text-gray-200">Team Chat ({roomCode})</span>
        <button
          onClick={() => setIsModelModalOpen(true)}
          className="text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#a1a1aa] hover:text-white hover:border-white/[0.16] transition"
          aria-label="Open model picker"
        >
          Model: {selectedModelLabel}
        </button>
      </div>
      <div className="flex-grow overflow-y-auto p-4 space-y-3">
        {messages.map((message, index) => {
          const messageKey = message.id || message.client_nonce || `${message.sender}-${message.timestamp || index}`;
          const isHackBuddy = isHackBuddySender(message.sender);
          return (
            <div key={messageKey} className="text-sm bg-white/[0.03] p-2 rounded-md">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-gray-300">
                  <span className="font-bold text-blue-400">{isHackBuddy ? "HackBuddy" : message.sender}: </span>
                  <span className="whitespace-pre-wrap">{message.message}</span>
                </p>
                {isHackBuddy && message.message.trim() && (
                  <button
                    onClick={() => {
                      void copyMessage(messageKey, message.message);
                    }}
                    className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-white/[0.06] text-[#a1a1aa] hover:text-white hover:border-white/[0.14] transition"
                    aria-label="Copy response"
                  >
                    {copiedMessageKey === messageKey ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {isAiThinking && <div className="text-xs text-gray-500 italic p-2">HackBuddy is thinking...</div>}
      </div>
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/[0.04]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message, 'create task [title]', or /clear..."
          className="w-full bg-white/[0.05] border border-white/[0.1] p-2.5 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </form>

      {isModelModalOpen && (
        <div className="absolute inset-0 z-30 bg-black/65 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-xs rounded-xl bg-[#0b0c0f] border border-white/[0.08] shadow-[0_16px_48px_rgba(0,0,0,0.45)] p-4">
            <div className="text-sm font-semibold text-white mb-1">Pick a chat model</div>
            <div className="text-xs text-[#71717a] mb-3">New prompts will use this model.</div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {modelOptions.map((model) => {
                const active = model.value === selectedModel;
                return (
                  <button
                    key={model.value}
                    onClick={() => {
                      onSelectModel(model.value);
                      setIsModelModalOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                      active
                        ? "border-blue-500/60 bg-blue-500/[0.12] text-white"
                        : "border-white/[0.08] bg-white/[0.02] text-[#d4d4d8] hover:border-white/[0.16]"
                    }`}
                  >
                    <div className="text-sm">{model.label}</div>
                    <div className="text-[11px] text-[#71717a]">{model.value}</div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setIsModelModalOpen(false)}
              className="mt-4 w-full text-sm rounded-lg border border-white/[0.08] py-2 text-[#a1a1aa] hover:text-white hover:border-white/[0.16] transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
