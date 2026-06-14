import type { ReactNode } from "react";

export type ToastType = "success" | "error" | "warn" | string;

export type Toast = {
  id: number;
  msg: ReactNode;
  type: ToastType;
};

export type ToastFn = (msg: ReactNode, type?: ToastType) => void;

export interface ChatMessage {
  id?: string;
  room_id?: string;
  sender: string;
  message: string;
  timestamp?: string;
  client_nonce?: string;
  is_streaming?: boolean;
  model?: string;
}

export type OnboardingProfile = {
  hackathonId: string;
  name: string;
  lookingForTeam: boolean;
  skills: string[];
  interest: string;
  vibe: string;
  discordUsername: string;
  anonymousInMatching: boolean;
  showDiscordWhenAnonymous: boolean;
};

export type AuthUser = {
  username: string;
  hackathon_id: string;
  looking_for_team: boolean;
  skills: string[];
  interest: string;
  vibe: string;
  discord_username: string;
  anonymous_in_matching: boolean;
  show_discord_when_anonymous: boolean;
  room_id?: string | null;
  team_id?: string | null;
  invite_code?: string | null;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  column: string;
  created_at: number;
  updated_at: number;
  deleted?: boolean;
};

export type AppPage = "Matching" | "Kanban" | "Whiteboard" | "Integrations" | "Roadmap";
