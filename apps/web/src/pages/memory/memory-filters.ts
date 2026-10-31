import type { Memory } from "@/api";
import { formatTimestamp } from "@/lib/date-format";

/**
 * An iron rule (铁律) is a locked memory, nothing else: the compiler always
 * hands locked rows to the agent and agents can never overwrite them. `tier`
 * only orders bootstrap, so a core-but-unlocked row is not a rule.
 */
export function isRule(memory: Memory) {
  return memory.verification === "locked";
}

/** Bucket a filtered memory list into the filter-pill views. */
export function groupMemories(filtered: Memory[]) {
  // A pending proposal is not a memory yet: it lives in the review inbox
  // only, where its conflict and decision buttons are shown.
  const active = filtered.filter(
    (m) => m.status === "active" && m.verification !== "inferred",
  );
  const core = active.filter(isRule);
  const observed = active.filter((m) => m.verification === "observed");
  // Archived project memories belong to the archive view only; counting them
  // here would inflate project badges and resurface them in project detail.
  const projects = active.filter((m) => m.scope_type === "project");
  const archive = filtered.filter((m) =>
    ["superseded", "archived", "deleted"].includes(m.status),
  );
  return { active, core, observed, projects, archive };
}

export type ProjectCount = { key: string; displayName: string; count: number };

/** Projects that hold at least one active memory, busiest first. */
export function countProjects(projectMemories: Memory[]): ProjectCount[] {
  const counts = new Map<string, number>();
  for (const m of projectMemories) {
    const key = m.scope_key ?? m.scope_type;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([key, count]) => ({
    key,
    displayName: formatProjectName(key),
    count,
  }));
  // A repo path and its `github:` key both shorten to the repo name; two
  // pills both reading "FlareMo" are indistinguishable, so spell those out.
  const seen = new Map<string, number>();
  for (const row of rows) {
    seen.set(row.displayName, (seen.get(row.displayName) ?? 0) + 1);
  }
  for (const row of rows) {
    if ((seen.get(row.displayName) ?? 0) > 1) {
      row.displayName = longProjectName(row.key);
    }
  }
  // Still colliding means the same repo under two key spellings
  // (`github:` vs `github.com/`): show the keys as they are, since agents
  // and the lens treat them as different projects.
  const longSeen = new Map<string, number>();
  for (const row of rows) {
    longSeen.set(row.displayName, (longSeen.get(row.displayName) ?? 0) + 1);
  }
  for (const row of rows) {
    if ((longSeen.get(row.displayName) ?? 0) > 1) row.displayName = row.key;
  }
  return rows.sort((a, b) => b.count - a.count);
}

function longProjectName(scopeKey: string) {
  if (scopeKey.startsWith("github:")) return scopeKey.slice(7);
  const parts = scopeKey.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.slice(-2).join("/") || scopeKey;
}

/** Formats a project scope key (filesystem path or git URL) into a clean display name. */
export function formatProjectName(scopeKey?: string | null): string {
  if (!scopeKey) return "";
  if (scopeKey.startsWith("github:")) {
    const repo = scopeKey.slice(7);
    return repo.split("/").pop() || repo;
  }
  const normalized = scopeKey.replace(/[\\/]+$/, "");
  const last = normalized.split(/[\\/]/).pop();
  return last || scopeKey;
}

export { formatTimestamp };
