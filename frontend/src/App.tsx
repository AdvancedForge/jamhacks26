import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const DASHBOARD_WALKTHROUGH_STORAGE_KEY = "hb_dashboard_walkthrough_seen";
type SpotlightTarget = "nav" | "main";
type SpotlightStep = {
  target: SpotlightTarget;
  title: string;
  description: string;
};

const SPOTLIGHT_STEPS: SpotlightStep[] = [
  {
    target: "nav",
    title: "Navigate your workspace",
    description: "Use these tabs to jump between Kanban, Whiteboard, Integrations, and Roadmap.",
  },
  {
    target: "main",
    title: "This is your task area",
    description: "This panel is where your board, whiteboard, and collaboration tools appear based on the tab you selected.",
  },
];

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
  const [showDashboardWalkthrough, setShowDashboardWalkthrough] = useState(false);
  const [walkthroughStepIndex, setWalkthroughStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const { toasts, add: toast } = useToasts();
  const navSpotlightRef = useRef<HTMLElement | null>(null);
  const mainSpotlightRef = useRef<HTMLElement | null>(null);

  const handlePoll = useCallback(() => setPolledAt((current) => current + 1), []);
  const activeWalkthroughStep = useMemo(() => SPOTLIGHT_STEPS[walkthroughStepIndex] || null, [walkthroughStepIndex]);

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

  const walkthroughStorageKey = `${DASHBOARD_WALKTHROUGH_STORAGE_KEY}:${authUser?.username || profile?.name || "guest"}`;

  const dismissDashboardWalkthrough = (persist = true) => {
    setShowDashboardWalkthrough(false);
    if (!persist) return;
    localStorage.setItem(walkthroughStorageKey, "true");
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

  useEffect(() => {
    if (!roomCode) {
      setShowDashboardWalkthrough(false);
      return;
    }
    const hasSeenWalkthrough = localStorage.getItem(walkthroughStorageKey) === "true";
    setShowDashboardWalkthrough(!hasSeenWalkthrough);
  }, [roomCode, walkthroughStorageKey]);

  useEffect(() => {
    if (!showDashboardWalkthrough) return;
    setWalkthroughStepIndex(0);
  }, [showDashboardWalkthrough]);

  const getSpotlightTarget = useCallback(
    (target: SpotlightTarget) => {
      if (target === "nav") return navSpotlightRef.current;
      return mainSpotlightRef.current;
    },
    [],
  );

  useEffect(() => {
    if (!showDashboardWalkthrough || !activeWalkthroughStep) {
      setSpotlightRect(null);
      return;
    }
    const updateSpotlight = () => {
      const targetElement = getSpotlightTarget(activeWalkthroughStep.target);
      if (!targetElement) {
        setSpotlightRect(null);
        return;
      }
      const rect = targetElement.getBoundingClientRect();
      const padding = activeWalkthroughStep.target === "main" ? 10 : 6;
      setSpotlightRect({
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: Math.max(0, rect.width + padding * 2),
        height: Math.max(0, rect.height + padding * 2),
      });
    };
    const frameId = window.requestAnimationFrame(updateSpotlight);
    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [activeWalkthroughStep, getSpotlightTarget, page, showDashboardWalkthrough]);

  const isLastWalkthroughStep = walkthroughStepIndex >= SPOTLIGHT_STEPS.length - 1;
  const goToNextWalkthroughStep = () => {
    if (isLastWalkthroughStep) {
      dismissDashboardWalkthrough();
      return;
    }
    setWalkthroughStepIndex((currentStep) => Math.min(currentStep + 1, SPOTLIGHT_STEPS.length - 1));
  };
  const goToPreviousWalkthroughStep = () => {
    setWalkthroughStepIndex((currentStep) => Math.max(currentStep - 1, 0));
  };

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const tooltipWidth = Math.max(260, Math.min(360, viewportWidth - 32));
  const tooltipLeft = spotlightRect
    ? Math.max(16, Math.min(spotlightRect.left, viewportWidth - tooltipWidth - 16))
    : 16;
  const tooltipTop = spotlightRect
    ? Math.max(16, Math.min(spotlightRect.top + spotlightRect.height + 14, viewportHeight - 220))
    : 16;

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
      <div className="h-screen bg-[#08090a] overflow-hidden">
        <MatchingPage profile={profile} authToken={authToken} toast={toast} onTeamReady={(nextRoomCode) => handleEnterRoom(nextRoomCode, profile.name)} />
        <ToastList toasts={toasts} />
      </div>
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

      <Topbar
        roomCode={roomCode}
        page={page}
        onNav={handleNav}
        polledAt={polledAt}
        onLogout={handleLogout}
        navRef={navSpotlightRef}
      />

      <main ref={mainSpotlightRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
      {showDashboardWalkthrough && spotlightRect && activeWalkthroughStep && (
        <div className="absolute inset-0 z-[70] pointer-events-none">
          <div
            className="absolute rounded-xl border border-white/25 transition-all duration-200"
            style={{
              top: spotlightRect.top,
              left: spotlightRect.left,
              width: spotlightRect.width,
              height: spotlightRect.height,
              boxShadow: "0 0 0 9999px rgba(2, 2, 6, 0.8)",
            }}
          />
          <div
            className="absolute pointer-events-auto rounded-xl border border-white/[0.12] bg-[#121317] px-4 py-3 shadow-2xl"
            style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#71717a]">
              Step {walkthroughStepIndex + 1}/{SPOTLIGHT_STEPS.length}
            </p>
            <h3 className="mt-1 text-[16px] font-semibold text-white">{activeWalkthroughStep.title}</h3>
            <p className="mt-1 text-[13px] text-[#a1a1aa]">{activeWalkthroughStep.description}</p>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => dismissDashboardWalkthrough(false)}
                className="text-[12px] text-[#a1a1aa] hover:text-white"
              >
                Remind me later
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPreviousWalkthroughStep}
                  disabled={walkthroughStepIndex === 0}
                  className="text-[12px] border border-white/[0.1] rounded-md px-3 py-1.5 text-white disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  onClick={goToNextWalkthroughStep}
                  className="text-[12px] rounded-md px-3 py-1.5 bg-white text-[#09090b] font-medium"
                >
                  {isLastWalkthroughStep ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastList toasts={toasts} />
    </div>
  );
}
