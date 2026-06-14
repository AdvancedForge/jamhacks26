import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../hackbuddyApi";
import type { OnboardingProfile, ToastFn } from "../hackbuddyTypes";

type TeammatePreview = {
  username: string;
  skills: string[];
  interest: string;
  vibe: string;
  discord_username?: string;
};

type IncomingInvite = {
  invite_id: string;
  from_username: string;
  team_id?: string | null;
  skills: string[];
  interest: string;
  vibe: string;
  discord_username?: string;
};

type OutgoingInvite = {
  invite_id: string;
  to_username: string;
  skills: string[];
  interest: string;
  vibe: string;
  discord_username?: string;
};

type MatchStatusResponse = {
  state?: "teammaking" | "in_room";
  team_id?: string;
  room_id?: string;
  invite_code?: string;
  looking_for_team?: boolean;
  incoming_invites?: IncomingInvite[];
  outgoing_invites?: OutgoingInvite[];
  candidates?: TeammatePreview[];
  teammates?: TeammatePreview[];
};

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  values.forEach((rawValue) => {
    const value = (rawValue || "").trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(value);
  });
  return merged;
}

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
  const [status, setStatus] = useState<MatchStatusResponse>({
    state: "teammaking",
    candidates: [],
    teammates: [],
    incoming_invites: [],
    outgoing_invites: [],
  });
  const [loadingInviteId, setLoadingInviteId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leavingTeam, setLeavingTeam] = useState(false);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [inviteUsernameInput, setInviteUsernameInput] = useState("");

  const teamMemberNames = uniqueNonEmpty([
    profile.name,
    ...(status.teammates || []).map((teammate) => teammate.username),
  ]);
  const teamSkills = uniqueNonEmpty([
    ...(profile.skills || []),
    ...(status.teammates || []).flatMap((teammate) => teammate.skills || []),
  ]);
  const teamInterests = uniqueNonEmpty([
    profile.interest,
    ...(status.teammates || []).map((teammate) => teammate.interest),
  ]);
  const teamVibes = uniqueNonEmpty([
    profile.vibe,
    ...(status.teammates || []).map((teammate) => teammate.vibe),
  ]);

  const fetchStatus = useCallback(async () => {
    const response = await apiFetch<MatchStatusResponse>("/api/matchmaking/status", {
      headers: { "X-Auth-Token": authToken },
    });
    setStatus({
      ...response,
      candidates: response.candidates || [],
      teammates: response.teammates || [],
      incoming_invites: response.incoming_invites || [],
      outgoing_invites: response.outgoing_invites || [],
    });
    if (response.state === "in_room" && response.room_id) {
      onTeamReady(response.room_id);
    }
  }, [authToken, onTeamReady]);

  const startTeammaking = async () => {
    setStarting(true);
    try {
      await apiFetch("/api/matchmaking/enroll", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: JSON.stringify({
          hackathon_id: profile.hackathonId || "default",
          name: profile.name,
          skills: profile.skills,
          interest: profile.interest,
          vibe: profile.vibe,
          discord_username: profile.discordUsername || undefined,
        }),
      });
      toast("You are now visible in teammaking.", "success");
      await fetchStatus();
    } catch {
      toast("Could not start teammaking.", "error");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        await fetchStatus();
      } catch {
        if (mounted) toast("Couldn't load teammaking status.", "warn");
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
  }, [fetchStatus, toast]);

  const inviteCandidate = async (candidateUsername: string) => {
    const normalizedCandidateUsername = candidateUsername.trim();
    if (!normalizedCandidateUsername) {
      toast("Enter a username to invite.", "warn");
      return false;
    }
    setLoadingInviteId(normalizedCandidateUsername);
    try {
      const response = await apiFetch<{ already_pending?: boolean }>("/api/matchmaking/invite", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: JSON.stringify({
          invitee_username: normalizedCandidateUsername,
        }),
      });
      toast(response.already_pending ? "Invite already pending." : "Invite sent.", "success");
      await fetchStatus();
      return true;
    } catch {
      toast("Failed to send invite.", "warn");
      return false;
    } finally {
      setLoadingInviteId(null);
    }
  };

  const inviteByUsername = async () => {
    const invited = await inviteCandidate(inviteUsernameInput);
    if (invited) setInviteUsernameInput("");
  };

  const respondInvite = async (inviteId: string, accept: boolean) => {
    setLoadingInviteId(inviteId);
    try {
      await apiFetch("/api/matchmaking/invite/respond", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: JSON.stringify({
          invite_id: inviteId,
          accept,
        }),
      });
      toast(accept ? "Invite accepted." : "Invite declined.", accept ? "success" : "warn");
      await fetchStatus();
    } catch {
      toast("Could not update invite.", "error");
    } finally {
      setLoadingInviteId(null);
    }
  };

  const leaveTeammaking = async () => {
    setLeaving(true);
    try {
      const response = await apiFetch<{ room_id?: string }>("/api/matchmaking/leave", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
      });
      if (!response.room_id) throw new Error("Missing room");
      toast("Left teammaking. Your board is ready.", "success");
      onTeamReady(response.room_id);
    } catch {
      toast("Could not leave teammaking.", "error");
    } finally {
      setLeaving(false);
    }
  };

  const joinByInviteCode = async () => {
    const code = inviteCodeInput.trim().toUpperCase();
    if (!code) {
      toast("Enter an invite code.", "warn");
      return;
    }
    setJoining(true);
    try {
      const response = await apiFetch<{ room_id?: string; in_room?: boolean }>("/api/team/join-by-code", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
        body: JSON.stringify({ invite_code: code }),
      });
      toast(response.in_room ? "Joined team room." : "Joined team in teammaking.", "success");
      if (response.in_room && response.room_id) onTeamReady(response.room_id);
      await fetchStatus();
    } catch {
      toast("Could not join team with that code.", "error");
    } finally {
      setJoining(false);
    }
  };

  const leaveTeam = async () => {
    setLeavingTeam(true);
    try {
      await apiFetch("/api/matchmaking/team/leave", {
        method: "POST",
        headers: { "X-Auth-Token": authToken },
      });
      toast("You left your team and are solo in teammaking again.", "success");
      await fetchStatus();
    } catch {
      toast("Could not leave team.", "error");
    } finally {
      setLeavingTeam(false);
    }
  };

  return (
    <div className="w-full min-h-screen p-8 bg-[#08090a] text-white">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-[20px] font-semibold text-white">Teammaking</h2>
          <p className="text-[13px] text-[#71717a] mt-2">
            Hackathon: <span className="text-[#d4d4d8]">{profile.hackathonId || "default"}</span>
          </p>
          <p className="text-[14px] text-[#a1a1aa] mt-4">
            Invite collaborators, respond to invites, and leave teammaking whenever your team is ready for a board.
          </p>
          {(status.room_id || status.invite_code) && (
            <div className="mt-4 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
              {status.room_id ? (
                <>
                  <p className="text-[12px] uppercase tracking-wide text-[#52525b]">Team room code</p>
                  <p className="text-[16px] text-white font-mono mt-1">{status.room_id}</p>
                  <p className="text-[12px] text-[#71717a] mt-1">Use this to join the normal room when your team is ready.</p>
                </>
              ) : null}
              {status.invite_code ? (
                <>
                  <p className="text-[12px] uppercase tracking-wide text-[#52525b] mt-3">Team invite code</p>
                  <p className="text-[16px] text-white font-mono mt-1">{status.invite_code}</p>
                  <p className="text-[12px] text-[#71717a] mt-1">Share this with anyone using Join Team.</p>
                </>
              ) : null}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => void leaveTeammaking()}
              disabled={leaving}
              className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl disabled:opacity-50"
            >
              {leaving ? "Leaving..." : "Leave Teammaking"}
            </button>
            {!status.looking_for_team && (
              <button
                onClick={() => void startTeammaking()}
                disabled={starting}
                className="bg-white/[0.05] border border-white/[0.08] text-white text-[14px] font-medium px-5 py-3 rounded-xl disabled:opacity-50"
              >
                {starting ? "Starting..." : "Start Teammaking"}
              </button>
            )}
          </div>
        </section>

        <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-[13px] text-[#71717a] mb-3">Join Team</p>
              <div className="flex gap-3">
                <input
                  value={inviteCodeInput}
                  onChange={(event) => setInviteCodeInput(event.target.value)}
                  placeholder="Enter team code"
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
                />
                <button
                  onClick={() => void joinByInviteCode()}
                  disabled={joining}
                  className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all disabled:opacity-50"
                >
                  {joining ? "Joining..." : "Join Team"}
                </button>
              </div>
            </div>

            <div>
              <p className="text-[13px] text-[#71717a] mb-3">Invite by Username</p>
              <div className="flex gap-3">
                <input
                  value={inviteUsernameInput}
                  onChange={(event) => setInviteUsernameInput(event.target.value)}
                  placeholder="Username to invite"
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] focus:border-white/[0.15] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#3f3f46] outline-none transition-all"
                />
                <button
                  onClick={() => void inviteByUsername()}
                  disabled={loadingInviteId === inviteUsernameInput.trim()}
                  className="bg-white text-[#09090b] text-[14px] font-medium px-5 py-3 rounded-xl transition-all disabled:opacity-50"
                >
                  Invite
                </button>
              </div>
            </div>
          </div>
          <p className="text-[12px] text-[#71717a] mt-2">
            Invite any teammate in teammatching by username, even if they are currently offline.
          </p>
        </section>

        {(status.incoming_invites || []).length > 0 && (
          <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-[16px] text-white font-medium">Incoming Invites</h3>
            <div className="mt-4 grid gap-4">
              {(status.incoming_invites || []).map((invite) => (
                <article key={invite.invite_id} className="border border-white/[0.06] bg-white/[0.02] rounded-xl p-4">
                  <p className="text-white text-[15px]">{invite.from_username}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Skills: {invite.skills.join(", ") || "N/A"}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Interest: {invite.interest || "N/A"}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Vibe: {invite.vibe || "N/A"}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void respondInvite(invite.invite_id, true)}
                      disabled={loadingInviteId === invite.invite_id}
                      className="bg-white text-[#09090b] text-[13px] px-4 py-2 rounded-lg disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => void respondInvite(invite.invite_id, false)}
                      disabled={loadingInviteId === invite.invite_id}
                      className="bg-white/[0.05] border border-white/[0.08] text-white text-[13px] px-4 py-2 rounded-lg disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {status.team_id && teamMemberNames.length > 0 && (
          <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-[16px] text-white font-medium">Current Team</h3>
              <button
                onClick={() => void leaveTeam()}
                disabled={leavingTeam}
                className="bg-white/[0.05] border border-white/[0.08] text-white text-[13px] px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {leavingTeam ? "Leaving team..." : "Leave Team"}
              </button>
            </div>
            <article className="mt-4 border border-white/[0.06] bg-white/[0.02] rounded-xl p-4">
              <p className="text-[13px] text-[#d4d4d8]">Members: {teamMemberNames.join(", ") || "N/A"}</p>
              <p className="text-[13px] text-[#d4d4d8] mt-1">Skills: {teamSkills.join(", ") || "N/A"}</p>
              <p className="text-[13px] text-[#d4d4d8] mt-1">Interests: {teamInterests.join(", ") || "N/A"}</p>
              <p className="text-[13px] text-[#d4d4d8] mt-1">Vibes: {teamVibes.join(", ") || "N/A"}</p>
              {status.room_id ? (
                <p className="text-[13px] text-[#d4d4d8] mt-1">
                  Room code: <span className="font-mono">{status.room_id}</span>
                </p>
              ) : null}
            </article>
          </section>
        )}

        {(status.outgoing_invites || []).length > 0 && (
          <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-[16px] text-white font-medium">Pending Outgoing Invites</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {(status.outgoing_invites || []).map((invite) => (
                <span key={invite.invite_id} className="text-[13px] text-[#d4d4d8] bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2">
                  {invite.to_username}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="bg-[#0f1012]/80 border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-[16px] text-white font-medium">People Looking for Teammates</h3>
          {(status.candidates || []).length === 0 ? (
            <p className="text-[14px] text-[#71717a] mt-3">No candidates available right now.</p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(status.candidates || []).map((candidate) => (
                <article key={candidate.username} className="border border-white/[0.06] bg-white/[0.02] rounded-xl p-4">
                  <p className="text-white text-[15px]">{candidate.username}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Skills: {candidate.skills.join(", ") || "N/A"}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Interest: {candidate.interest || "N/A"}</p>
                  <p className="text-[13px] text-[#d4d4d8] mt-1">Vibe: {candidate.vibe || "N/A"}</p>
                  {candidate.discord_username ? (
                    <p className="text-[13px] text-[#d4d4d8] mt-1">Discord: {candidate.discord_username}</p>
                  ) : null}
                  <button
                    onClick={() => void inviteCandidate(candidate.username)}
                    disabled={loadingInviteId === candidate.username}
                    className="mt-3 bg-white text-[#09090b] text-[13px] px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    Invite to Collaborate
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}