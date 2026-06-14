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
const PAGE_STORAGE_KEY = "hb_page";
const ROOM_STORAGE_KEY = "hb_room_code";
const DISPLAY_NAME_STORAGE_KEY = "hb_display_name";

const profileFromAuthUser = (user: AuthUser): OnboardingProfile => ({
  hackathonId: (user.hackathon_id || "").trim(),
  name: (user.username || "").trim(),
  lookingForTeam: Boolean(user.looking_for_team),
  skills: Array.isArray(user.skills) ? user.skills.map((skill) => String(skill).trim()).filter(Boolean) : [],
  interest: (user.interest || "").trim(),
  vibe: (user.vibe || "").trim(),
  discordUsername: (user.discord_username || "").trim(),
});

const readStoredProfile = (): OnboardingProfile | null => {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingProfile>;
    if (!parsed || typeof parsed !== "object") return null;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const hackathonId = typeof parsed.hackathonId === "string" ? parsed.hackathonId.trim() : "";
    const interest = typeof parsed.interest === "string" ? parsed.interest.trim() : "";
    const vibe = typeof parsed.vibe === "string" ? parsed.vibe.trim() : "";
    const discordUsername = typeof parsed.discordUsername === "string" ? parsed.discordUsername.trim() : "";
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.map((skill) => String(skill).trim()).filter(Boolean)
      : [];
    if (!name) return null;
    return {
      name,
      hackathonId,
      lookingForTeam: Boolean(parsed.lookingForTeam),
      skills,
      interest,
      vibe,
      discordUsername,
    };
  } catch {
    return null;
  }
};

const normalizePage = (rawPage: string | null): AppPage => {
  if (rawPage === "Kanban" || rawPage === "Whiteboard" || rawPage === "Integrations" || rawPage === "Roadmap") {
    return rawPage;
  }
  return "Kanban";
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
  const [profile, setProfile] = useState<OnboardingProfile | null>(() => {
    const storedProfile = readStoredProfile();
    if (storedProfile) return storedProfile;
    return authUser ? profileFromAuthUser(authUser) : null;
  });
  const [roomCode, setRoomCode] = useState(() => {
    const storedRoom = (localStorage.getItem(ROOM_STORAGE_KEY) || "").trim();
    if (storedRoom) return storedRoom;
    return (authUser?.room_id || "").toString().trim();
  });
  const [displayName, setDisplayName] = useState(() => {
    const storedName = (localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || "").trim();
    if (storedName) return storedName;
    if (authUser?.username) return authUser.username;
    return profile?.name || "You";
  });
  const [page, setPage] = useState<AppPage>(() => normalizePage(localStorage.getItem(PAGE_STORAGE_KEY)));
  const [polledAt, setPolledAt] = useState(0);
  const { toasts, add: toast } = useToasts();

  const handlePoll = useCallback(() => setPolledAt((current) => current + 1), []);

  const handleAuthenticated = (token: string, user: AuthUser, onboardingProfile: OnboardingProfile) => {
    setAuthToken(token);
    setAuthUser(user);
    setProfile(onboardingProfile);
    setDisplayName(user.username || onboardingProfile.name || "You");
    localStorage.setItem("hb_auth_token", token);
    localStorage.setItem("hb_auth_user", JSON.stringify(user));
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(onboardingProfile));
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, user.username || onboardingProfile.name || "You");
    const authRoom = (user.room_id || "").toString().trim();
    if (authRoom) {
      setRoomCode(authRoom);
      setPage("Kanban");
      localStorage.setItem(ROOM_STORAGE_KEY, authRoom);
      localStorage.setItem(PAGE_STORAGE_KEY, "Kanban");
    } else {
      setRoomCode("");
      localStorage.removeItem(ROOM_STORAGE_KEY);
    }
  };

  const handleEnterRoom = (nextRoomCode: string, nextDisplayName: string) => {
    const normalizedRoom = (nextRoomCode || "").trim().toUpperCase();
    if (!normalizedRoom) return;
    const resolvedName = nextDisplayName.trim() || profile?.name || authUser?.username || "You";
    setRoomCode(normalizedRoom);
    setDisplayName(resolvedName);
    setPage("Kanban");
    localStorage.setItem(ROOM_STORAGE_KEY, normalizedRoom);
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, resolvedName);
    localStorage.setItem(PAGE_STORAGE_KEY, "Kanban");
    setAuthUser((currentUser) => {
      if (!currentUser) return currentUser;
      const updatedUser = { ...currentUser, room_id: normalizedRoom };
      localStorage.setItem("hb_auth_user", JSON.stringify(updatedUser));
      return updatedUser;
    });
  };

  const handleProfileUpdate = (nextProfile: OnboardingProfile) => {
    setProfile(nextProfile);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
  };

  const handleNav = (newPage: AppPage) => {
    setPage(newPage);
    localStorage.setItem(PAGE_STORAGE_KEY, newPage);
  };
  const handleLogout = () => {
    setAuthToken("");
    setAuthUser(null);
    setProfile(null);
    setRoomCode("");
    setDisplayName("You");
    setPage("Kanban");
    localStorage.removeItem("hb_auth_token");
    localStorage.removeItem("hb_auth_user");
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(ROOM_STORAGE_KEY);
    localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    localStorage.removeItem(PAGE_STORAGE_KEY);
  };


  useEffect(() => {
    if (!authToken) return;
    const refresh = async () => {
      try {
        const response = await apiFetch<{ user?: AuthUser }>("/api/auth/me", {
          headers: { "X-Auth-Token": authToken },
        });
        if (!response.user) return;
        setAuthUser(response.user);
        localStorage.setItem("hb_auth_user", JSON.stringify(response.user));
        const refreshedProfile = profileFromAuthUser(response.user);
        setProfile(refreshedProfile);
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(refreshedProfile));
        const authRoom = (response.user.room_id || "").toString().trim();
        if (authRoom) {
          setRoomCode(authRoom);
          localStorage.setItem(ROOM_STORAGE_KEY, authRoom);
        }
      } catch {
        // keep local state as fallback
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [authToken]);

  const isTeammakingView = !roomCode && Boolean(authToken) && Boolean(authUser) && Boolean(profile);

  if (!roomCode && !isTeammakingView) {
    return (
      <>
        <EntryScreen onAuthenticated={handleAuthenticated} onEnterRoom={handleEnterRoom} />
        <ToastList toasts={toasts} />
      </>
    );
  }

  if (!roomCode && isTeammakingView && profile) {
    return (
      <>
        <MatchingPage profile={profile} authToken={authToken} toast={toast} onTeamReady={(nextRoomCode) => handleEnterRoom(nextRoomCode, profile.name)} />
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

      <Topbar roomCode={roomCode} page={page} onNav={handleNav} polledAt={polledAt} onLogout={handleLogout} />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {page === "Kanban" && (
          <BoardPage
            roomCode={roomCode}
            toast={toast}
            onPoll={handlePoll}
            currentUserName={displayName}
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
