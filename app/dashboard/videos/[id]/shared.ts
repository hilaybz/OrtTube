// Shared types and time helpers for the video editor components.

export interface SavedQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  ai_generated: boolean;
  order_index: number;
}

export interface SavedCheckpoint {
  id: string;
  position_seconds: number;
  label: string | null;
  order_index: number;
  questions: SavedQuestion[];
}

export function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function parseMinSec(s: string): number | null {
  const colonMatch = s.trim().match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  const numMatch = s.trim().match(/^\d+$/);
  if (numMatch) return parseInt(s.trim());
  return null;
}
