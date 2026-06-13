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

export type AppPage = "Board" | "Whiteboard" | "Integrations";
