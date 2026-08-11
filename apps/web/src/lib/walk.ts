import type { Memo, ReviewWalkVia } from "@/api";

export type WalkStep = {
  memo: Memo;
  /** How the walker arrived at this memo; the first step has no via. */
  via: ReviewWalkVia | null;
};

export type WalkSummary = {
  count: number;
  characters: number;
  earliest: string | null;
  latest: string | null;
};

export function summarizeWalk(steps: WalkStep[]): WalkSummary {
  let characters = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const step of steps) {
    characters += step.memo.content.length;
    const created = step.memo.create_time;
    if (Number.isNaN(new Date(created).getTime())) continue;
    if (!earliest || created < earliest) earliest = created;
    if (!latest || created > latest) latest = created;
  }
  return { count: steps.length, characters, earliest, latest };
}

export type Season = "spring" | "summer" | "autumn" | "winter";

export function seasonOf(value: string): Season | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

export function yearOf(value: string): number | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getFullYear();
}
