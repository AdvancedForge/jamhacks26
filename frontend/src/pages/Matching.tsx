import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { OnboardingProfile, ToastFn } from "../hackbuddyTypes";

type TeammatePreview = {
  display_name?: string;
  is_anonymous?: boolean;
  discord_username?: string;
  skills: string[];
  interest: string;
  vibe: string;
};

type MatchStatusResponse = {
  state?: "waiting" | "proposal" | "matched" | "solo" | "pending";
  message?: string;
  proposal_id?: string;
  team_id?: string;
  room_id?: string;
  invite_code?: string;
  teammates?: TeammatePreview[];
};

export default function MatchingPage({
  profile,
  authToken,
  toast,
  onTeamReady,
}: {
  profile: OnboardingProfile;
  authToken: string;
  toast: ToastFn;
  onTeamReady: (roomCode: string) => void;
}) {
  const [status, setStatus] = useState<MatchStatusResponse>({ state: "waiting" });
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");

  const lobbyRoomId = `lobby:${(profile.hackathonId || "default").trim().toLowerCase()}`;

  const enroll = useCallback(async () => {
    if (!profile.lookingForTeam) return;
    await apiFetch("/api/matchmaking/enroll", {
      method: "POST",
      body: JSON.stringify({
        room_id: lobbyRoomId,
        hackathon_id: profile.hackathonId || "default",
        name: profile.name,
        skills: profile.skills,
        interest: profile.interest,
        vibe: profile.vibe,
        discord_username: profile.discordUsername || undefined,
        anonymous_in_matching: profile.anonymousInMatching,
        show_discord_when_anonymous: profile.showDiscordWhenAnonymous,
      }),
    });
  }, [
    lobbyRoomId,
    profile.anonymousInMatching,
    profile.discordUsername,
    profile.hackathonId,
    profile.interest,
    profile.lookingForTeam,
    profile.name,
    profile.showDiscordWhenAnonymous,
    profile.skills,
    profile.vibe,
  ]);

  const fetchStatus = useCallback(async () => {
    if (!profile.lookingForTeam) {
      setStatus({
        state: "solo",
        message: "You’re marked as already having a team. Use an invite code to enter your team room.",
      });
      return;
    }
    const response = await apiFetch<MatchStatusResponse>(
      `/api/matchmaking/status?room_id=${encodeURIComponent(lobbyRoomId)}&hackathon_id=${encodeURIComponent(
        profile.hackathonId || "default",
      )}&name=${encodeURIComponent(profile.name)}`,
    );
    setStatus(response);
    if (response.state === "matched" && response.room_id) {
      onTeamReady(response.room_id);
    }
  }, [lobbyRoomId, onTeamReady, profile.hackathonId, profile.lookingForTeam, profile.name]);

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        await enroll();
        if (!mounted) return;
        await fetchStatus();
      } catch {
        if (mounted) toast("Couldn't enroll in matchmaking.", "warn");
      }
    };
    void boot();
    const interval = window.setInterval(() => {
      void fetchStatus();
    }, 4000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [enroll, fetchStatus, toast]);

  const submitDecision = async (interested: boolean) => {
    if (!status.proposal_id) return;
    setLoadingDecision(true);
    try {
      await apiFetch("/api/matchmaking/decision", {
        method: "POST",
        body: JSON.stringify({
          room_id: lobbyRoomId,
          hackathon_id: profile.hackathonId || "default",
          name: profile.name,
          proposal_id: status.proposal_id,
          interested,
        }),
      });
      await fetchStatus();
    } catch {
      toast("Failed to submit matchmaking decision.", "warn");
    } finally {
      setLoadingDecision(false);
    }
  };

  const joinByInviteCode = async () => {
    const code = inviteCodeInput.trim().toUpperCase();
    if (!code) {
      toast("Enter an invite code.", "warn");
      return;
    }
    try {
      const response = await apiFetch<{ room_id?: string }>("/api/team/join-by-code", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: JSON.stringify({ invite_code: code }),
      });
      toast("Joined team via invite code.", "success");
      if (response.room_id) onTeamReady(response.room_id);
      await fetchStatus();
    } catch {
      toast("Could not join team with that code.", "error");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-[#08090a]">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-[20px] font-semibold text-white">Team Matching</h2>
          <p className="text-[13px] text-[#71717a] mt-2">
            Hackathon: <span className="text-[#d4d4d8]">{profile.hackathonId || "default"}</span>
          </p>
          {status.state === "waiting" && (
            <p className="text-[14px] text-[#a1a1aa] mt-4">
              {status.message || "Thanks! You’ll be matched with a team soon."}
            </p>
          )}
          {status.state === "proposal" && (
            <p className="text-[14px] text-[#a1a1aa] mt-4">
              {status.message || "A team request is waiting for your response."}
            </p>
          )}
          {status.state === "pending" && (
            <p className="text-[14px] text-[#a1a1aa] mt-4">
              Decision sent. Waiting for your potential teammate(s) to respond.
            </p>
          )}
          {status.state === "solo" && (
            <p className="text-[14px] text-[#f59e0b] mt-4">
              {status.message || "You are currently in solo mode for this hackathon."}
            </p>
          )}
          {status.state === "matched" && (
            <div className="mt-4">
              <p className="text-[14px] text-[#22c55e]">Team formed successfully.</p>
              <p className="text-[12px] text-[#71717a] mt-1">Team ID: {status.team_id}</p>
              {status.invite_code ? <p className="text-[12px] text-[#71717a] mt-1">Invite code: {status.invite_code}</p> : null}
              {status.room_id ? <p className="text-[12px] text-[#71717a] mt-1">Room: {status.room_id}</p> : null}
            </div>
          )}
        </section>

        {status.state !== "matched" && (
          <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
            <p className="text-[13px] text-[#71717a] mb-3">Have a team invite code?</p>
            <div className="flex gap-3">
              <input
                value={inviteCodeInput}
                onChange={(event) => setInviteCodeInput(event.target.value)}
                placeholder="Enter invite code"
                className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
              />
              <button
                onClick={() => void joinByInviteCode()}
                className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all"
              >
                Join
              </button>
            </div>
          </section>
        )}

        {(status.state === "proposal" || status.state === "matched") && (status.teammates || []).length > 0 && (
          <section className="grid gap-4">
            {(status.teammates || []).map((teammate, index) => (
              <article key={`${index}-${teammate.vibe}`} className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-5">
                <p className="text-[12px] uppercase tracking-wide text-[#52525b]">Teammate {index + 1}</p>
                <p className="text-[15px] text-white mt-2">{teammate.display_name || "Teammate"}</p>
                <p className="text-[14px] text-[#d4d4d8] mt-2">
                  <span className="text-[#71717a]">Skills:</span> {teammate.skills?.join(", ") || "N/A"}
                </p>
                <p className="text-[14px] text-[#d4d4d8] mt-1">
                  <span className="text-[#71717a]">Interest:</span> {teammate.interest || "N/A"}
                </p>
                <p className="text-[14px] text-[#d4d4d8] mt-1">
                  <span className="text-[#71717a]">Vibe:</span> {teammate.vibe || "N/A"}
                </p>
              </article>
            ))}
          </section>
        )}

        {status.state === "proposal" && (
          <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6 flex gap-3">
            <button
              onClick={() => void submitDecision(true)}
              disabled={loadingDecision}
              className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all disabled:opacity-50"
            >
              I’m interested
            </button>
            <button
              onClick={() => void submitDecision(false)}
              disabled={loadingDecision}
              className="bg-white/[0.05] border border-white/[0.08] text-white text-[14px] font-medium px-5 py-3 rounded-xl transition-all disabled:opacity-50"
            >
              Not interested
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
