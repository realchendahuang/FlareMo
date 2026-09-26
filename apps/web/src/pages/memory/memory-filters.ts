import type { Memory } from "@/api";
import { formatTimestamp } from "@/lib/date-format";

/** Bucket a filtered memory list into the filter-pill views. */
export function groupMemories(filtered: Memory[]) {
  const active = filtered.filter((m) => m.status === "active");
  const core = active.filter((m) => m.tier === "core");
  const observed = active.filter((m) => m.verification === "observed");
  // Archived project memories belong to the archive view only; counting them
  // here would inflate project badges and resurface them in project detail.
  const projects = active.filter((m) => m.scope_type === "project");
  const archive = filtered.filter((m) =>
    ["superseded", "archived", "deleted"].includes(m.status),
  );
  return { active, core, observed, projects, archive };
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
