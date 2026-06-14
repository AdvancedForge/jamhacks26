import { useCallback, useEffect, useState } from "react";
import EntryScreen from "./components/EntryScreen";
import ToastList from "./components/ToastList";
import Topbar from "./components/Topbar";
import { useToasts } from "./hooks/useToasts";
import type { AppPage, AuthUser, OnboardingProfile } from "./hackbuddyTypes";
import BoardPage from "./pages/Board";
import WhiteboardPage from "./pages/Whiteboard";
import IntegrationsPage from "./pages/Integrations";
import MatchingPage from "./pages/Matching";
import { apiFetch } from "./hackbuddyApi";

import RoadmapPage from "./pages/Roadmap";
const PROFILE_STORAGE_KEY = "hb_profile";
const profileFromAuthUser = (user: AuthUser): OnboardingProfile => ({
  hackathonId: (user.hackathon_id || "").trim(),
  name: (user.username || "").trim(),
  lookingForTeam: Boolean(user.looking_for_team),
  skills: Array.isArray(user.skills) ? user.skills.map((skill) => String(skill).trim()).filter(Boolean) : [],
  interest: (user.interest || "").trim(),
  vibe: (user.vibe || "").trim(),
  discordUsername: (user.discord_username || "").trim(),
  anonymousInMatching: Boolean(user.anonymous_in_matching),
  showDiscordWhenAnonymous: Boolean(user.show_discord_when_anonymous),
});

const readStoredProfile = (): OnboardingProfile | null => {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingProfile>;
    if (!parsed || typeof parsed !== "object") return null;
    const hackathonId = typeof parsed.hackathonId === "string" ? parsed.hackathonId.trim() : "";
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const interest = typeof parsed.interest === "string" ? parsed.interest.trim() : "";
    const vibe = typeof parsed.vibe === "string" ? parsed.vibe.trim() : "";
    const lookingForTeam = Boolean(parsed.lookingForTeam);
    const discordUsername = typeof parsed.discordUsername === "string" ? parsed.discordUsername.trim() : "";
    const anonymousInMatching = Boolean(parsed.anonymousInMatching);
    const showDiscordWhenAnonymous = parsed.showDiscordWhenAnonymous !== false;
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.map((skill) => String(skill).trim()).filter(Boolean)
      : [];
    if (!name || !interest || !hackathonId) return null;
    return {
      hackathonId,
      name,
      lookingForTeam,
      interest,
      vibe,
      skills,
      discordUsername,
      anonymousInMatching,
      showDiscordWhenAnonymous,
    };
  } catch {
    return null;
  }
};

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("hb_auth_token") || "");
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem("hb_auth_user");
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  });
  const [roomCode, setRoomCode] = useState(() => (authUser?.room_id || "").toString());
  const [page, setPage] = useState<AppPage>(() => (localStorage.getItem("hb_page") as AppPage) || "Matching");
  const [profile, setProfile] = useState<OnboardingProfile | null>(() => readStoredProfile());
  const [polledAt, setPolledAt] = useState(Date.now());
  const { toasts, add: toast } = useToasts();
  const handlePoll = useCallback(() => setPolledAt(Date.now()), []);

  const handleAuthenticated = (token: string, user: AuthUser, onboardingProfile: OnboardingProfile) => {
    setAuthToken(token);
    setAuthUser(user);
    setRoomCode((user.room_id || "").toString());
    setPage("Matching");
    setProfile(onboardingProfile);
    localStorage.setItem("hb_auth_token", token);
    localStorage.setItem("hb_auth_user", JSON.stringify(user));
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(onboardingProfile));
    localStorage.setItem("hb_page", "Matching");
  };

  const handleProfileUpdate = (nextProfile: OnboardingProfile) => {
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
  };

  const handleNav = (newPage: AppPage) => {
    setPage(newPage);
    localStorage.setItem("hb_page", newPage);
  };
  useEffect(() => {
    if (!authToken) return;
    const refresh = async () => {
      try {
        const response = await apiFetch<{ user?: AuthUser }>("/api/auth/me", {
          headers: { "X-Auth-Token": authToken },
        });
        if (response.user) {
          setAuthUser(response.user);
          setRoomCode((response.user.room_id || "").toString());
          const refreshedProfile = profileFromAuthUser(response.user);
          setProfile(refreshedProfile);
          localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(refreshedProfile));
          localStorage.setItem("hb_auth_user", JSON.stringify(response.user));
        }
      } catch {
        // keep local session state as fallback
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      window.clearInterval(interval);
    };
  }, [authToken]);

  if (!authToken || !authUser || !profile) {
    return (
      <>
        <EntryScreen onAuthenticated={handleAuthenticated} />
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
        {(!roomCode || page === "Matching") && (
          <MatchingPage profile={profile} authToken={authToken} toast={toast} />
        )}
        {page === "Kanban" && roomCode && (
          <BoardPage
            roomCode={roomCode}
            toast={toast}
            onPoll={handlePoll}
            currentUserName={profile?.name}
          />
        )}
        {page === "Whiteboard" && roomCode && <WhiteboardPage roomCode={roomCode} toast={toast} />}
        {page === "Integrations" && roomCode && (
          <IntegrationsPage
            roomCode={roomCode}
            toast={toast}
            profile={profile}
            onProfileChange={handleProfileUpdate}
          />
        )}
        {page === "Roadmap" && roomCode && <RoadmapPage roomCode={roomCode} toast={toast} />}
      </main>

      <ToastList toasts={toasts} />
    </div>
  );
}
