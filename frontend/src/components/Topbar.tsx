import { useEffect, useState } from "react";
import type { AppPage } from "../hackbuddyTypes";

const NAV: AppPage[] = ["Board", "Whiteboard", "Integrations"];

export default function Topbar({
  roomCode,
  page,
  onNav,
  polledAt,
}: {
  roomCode: string;
  page: AppPage;
  onNav: (page: AppPage) => void;
  polledAt: number;
}) {
  const [secAgo, setSecAgo] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSecAgo(Math.floor((Date.now() - polledAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [polledAt]);

  return (
    <header className="flex items-center gap-4 px-6 bg-[#0a0b0d]/80 backdrop-blur-xl border-b border-white/4 shrink-0 h-14">
      <div className="flex items-center gap-2.5 mr-3">
        <div className="w-7 h-7 rounded-lg bg-white/4 border border-white/6 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
            <rect x="5" y="8" width="7" height="12" rx="1.5" fill="#ffffff" fillOpacity=".4" />
            <rect x="14" y="5" width="9" height="7" rx="1.5" fill="#ffffff" />
            <rect x="14" y="14" width="9" height="6" rx="1.5" fill="#ffffff" fillOpacity=".3" />
          </svg>
        </div>
        <span className="text-white text-[15px] font-semibold tracking-tight hidden sm:block">HackBuddy</span>
      </div>

      <nav className="flex gap-1 bg-white/2 border border-white/4 rounded-lg p-1">
        {NAV.map((nav) => (
          <button
            key={nav}
            onClick={() => onNav(nav)}
            className={`text-[13px] px-3 py-1.5 rounded-md transition-all ${
              page === nav ? "bg-white/8 text-white" : "text-[#71717a] hover:text-[#a1a1aa]"
            }`}
          >
            {nav}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              secAgo < 5 ? "bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-[#52525b]"
            }`}
          />
          <span className="text-[12px] text-[#52525b] hidden sm:block">{secAgo < 5 ? "Live" : `${secAgo}s`}</span>
        </div>
        <div className="font-mono text-[12px] text-[#71717a] bg-white/3 border border-white/6 rounded-lg px-3 py-1.5 tracking-wide">
          {roomCode}
        </div>
      </div>
    </header>
  );
}
