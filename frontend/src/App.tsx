import { useCallback, useState } from "react";
import EntryScreen from "./components/EntryScreen";
import ToastList from "./components/ToastList";
import Topbar from "./components/Topbar";
import { useToasts } from "./hooks/useToasts";
import type { AppPage, OnboardingProfile } from "./hackbuddyTypes";
import BoardPage from "./pages/Board";
import WhiteboardPage from "./pages/Whiteboard";
import IntegrationsPage from "./pages/Integrations";

import RoadmapPage from "./pages/Roadmap";
const PROFILE_STORAGE_KEY = "hb_profile";

const readStoredProfile = (): OnboardingProfile | null => {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingProfile>;
    if (!parsed || typeof parsed !== "object") return null;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const interest = typeof parsed.interest === "string" ? parsed.interest.trim() : "";
    const vibe = typeof parsed.vibe === "string" ? parsed.vibe.trim() : "";
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.map((skill) => String(skill).trim()).filter(Boolean)
      : [];
    if (!name || !interest || !vibe) return null;
    return { name, interest, vibe, skills };
  } catch {
    return null;
  }
};

export default function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("hb_room") || "");
  const [page, setPage] = useState<AppPage>(() => (localStorage.getItem("hb_page") as AppPage) || "Kanban");
  const [profile, setProfile] = useState<OnboardingProfile | null>(() => readStoredProfile());
  const [polledAt, setPolledAt] = useState(Date.now());
  const { toasts, add: toast } = useToasts();
  const handlePoll = useCallback(() => setPolledAt(Date.now()), []);
  const handleEnter = (code: string, onboardingProfile: OnboardingProfile) => {
    setRoomCode(code);
    setPage("Kanban");
    setProfile(onboardingProfile);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(onboardingProfile));
  };

  const handleProfileUpdate = (nextProfile: OnboardingProfile) => {
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
  };

  const handleNav = (newPage: AppPage) => {
    setPage(newPage);
    localStorage.setItem("hb_page", newPage);
  };

  if (!roomCode) {
    return (
      <>
        <EntryScreen onEnter={handleEnter} />
        <ToastList toasts={toasts} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#08090a] text-white overflow-hidden">
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawer {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-up  { animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-drawer    { animation: drawer 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>

      <Topbar roomCode={roomCode} page={page} onNav={handleNav} polledAt={polledAt} />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {page === "Kanban" && (
          <BoardPage
            roomCode={roomCode}
            toast={toast}
            onPoll={handlePoll}
            currentUserName={profile?.name}
          />
        )}
        {page === "Whiteboard" && <WhiteboardPage roomCode={roomCode} toast={toast} />}
        {page === "Integrations" && (
          <IntegrationsPage
            roomCode={roomCode}
            toast={toast}
            profile={profile}
            onProfileChange={handleProfileUpdate}
          />
        )}
        {page === "Roadmap" && <RoadmapPage roomCode={roomCode} toast={toast} />}
      </main>

      <ToastList toasts={toasts} />
    </div>
  );
}
