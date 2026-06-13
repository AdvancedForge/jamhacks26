import { useState } from "react";

type ChatMessage = {
  id?: string;
  sender: string;
  message: string;
  timestamp?: string;
};

export const ChatWindow = ({
  roomCode,
  messages,
  onSendMessage,
}: {
  roomCode: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-[#08090a] border-l border-white/[0.04]">
      <div className="p-4 border-b border-white/[0.04] font-bold text-gray-200">
        Team Chat ({roomCode})
      </div>
      <div className="flex-grow overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={m.id || `${m.timestamp || ""}-${m.sender}-${i}`} className="text-sm bg-white/[0.03] p-2 rounded-md">
            <span className="font-bold text-blue-400">{m.sender}: </span>
            <span className="text-gray-300">{m.message}</span>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/[0.04]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message or 'create task [title]'..."
          className="w-full bg-white/[0.05] border border-white/[0.1] p-2.5 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </form>
    </div>
  );
};
