import { apiRequest } from "./client";
import type {
  CompiledMemoryDto,
  CreateMemoryRequest,
  Memory,
  MemoryRevision,
  UpdateMemoryRequest,
} from "./types";

export type ListMemoriesParams = {
  q?: string;
  type?: Memory["type"];
  kind?: Memory["kind"];
  scope_type?: Memory["scope_type"];
  scope_key?: string;
  tier?: Memory["tier"];
  verification?: Memory["verification"];
  status?: Memory["status"];
  source_agent?: string;
  needs_review?: boolean;
};

// The workspace renders the ledger whole (tabs, project groups and counts are
// all derived client-side), so the browser still needs every page. It walks
// the server cursor in bounded requests instead of asking the Worker for one
// unbounded read; the cap only guards against a runaway loop.
const MEMORY_PAGE_SIZE = 100;
const MEMORY_PAGE_LIMIT = 50;

function buildMemoryQuery(params: ListMemoriesParams) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.type) query.set("type", params.type);
  if (params.kind) query.set("kind", params.kind);
  if (params.scope_type) query.set("scope_type", params.scope_type);
  if (params.scope_key) query.set("scope_key", params.scope_key);
  if (params.tier) query.set("tier", params.tier);
  if (params.verification) query.set("verification", params.verification);
  if (params.status) query.set("status", params.status);
  if (params.source_agent) query.set("source_agent", params.source_agent);
  if (params.needs_review !== undefined)
    query.set("needs_review", String(params.needs_review));
  return query;
}

export async function listMemories(params: ListMemoriesParams = {}) {
  const memories: Memory[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MEMORY_PAGE_LIMIT; page += 1) {
    const query = buildMemoryQuery(params);
    query.set("page_size", String(MEMORY_PAGE_SIZE));
    if (pageToken) query.set("page_token", pageToken);
    const result = await apiRequest<{
      memories: Memory[];
      next_page_token?: string;
    }>(`/api/app/memory?${query.toString()}`);
    memories.push(...result.memories);
    pageToken = result.next_page_token;
    if (!pageToken) break;
  }
  return { memories };
}

export async function listMemoryReview() {
  return apiRequest<{ memories: Memory[] }>("/api/app/memory/review");
}

export async function createMemory(input: CreateMemoryRequest) {
  return apiRequest<{ duplicate: boolean; memory: Memory }>("/api/app/memory", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemory(id: string, input: UpdateMemoryRequest) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteMemory(id: string) {
  return apiRequest<{ ok: true }>(`/api/app/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function confirmMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/confirm`,
    { method: "POST" },
  );
}

export async function lockMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/lock`,
    { method: "POST" },
  );
}

export async function unlockMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/unlock`,
    { method: "POST" },
  );
}

export async function archiveMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/archive`,
    { method: "POST" },
  );
}

export async function listMemoryRevisions(id: string) {
  return apiRequest<{ revisions: MemoryRevision[] }>(
    `/api/app/memory/${encodeURIComponent(id)}/revisions`,
  );
}

export async function createMemoryFromMemo(
  memoId: string,
  input: {
    content?: string;
    type?: Memory["type"];
    kind?: Memory["kind"];
    scope_type?: Memory["scope_type"];
    scope_key?: string;
    tier?: Memory["tier"];
    importance?: number;
    lock?: boolean;
  },
) {
  return apiRequest<{ duplicate: boolean; memory: Memory }>(
    `/api/app/memos/${encodeURIComponent(memoId)}/memory`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function promoteMemoryToMemo(id: string) {
  return apiRequest<{ memory: Memory; memo: string }>(
    `/api/app/memory/${encodeURIComponent(id)}/promote`,
    { method: "POST" },
  );
}

export async function restoreMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
  );
}

export async function pinMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/pin`,
    { method: "POST" },
  );
}

export async function unpinMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}/unpin`,
    { method: "POST" },
  );
}

export async function resolveProposal(
  id: string,
  input: {
    action: "accept" | "reject" | "modify";
    modified_content?: string;
    rejection_reason?: string;
  },
) {
  return apiRequest<{
    resolved: boolean;
    action: string;
    memory: Memory;
  }>(`/api/app/memory/proposals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMemoryLineage(id: string) {
  return apiRequest<{
    lineage: {
      current: Memory;
      chain: Memory[];
      revisions: MemoryRevision[];
      evidence: unknown[];
      events: unknown[];
    };
  }>(`/api/app/memory/${encodeURIComponent(id)}/lineage`);
}

export async function getMemoryEvidence(id: string) {
  return apiRequest<{ evidence: unknown[] }>(
    `/api/app/memory/${encodeURIComponent(id)}/evidence`,
  );
}

/**
 * What an agent would receive right now: the same compile the MCP
 * `memory_compile` tool runs, without archiving it. `agent` is required by
 * the contract; the web preview uses a neutral name so no agent-scoped
 * memories leak into the general view.
 */
export async function compileMemory(params: { project_key?: string } = {}) {
  const query = new URLSearchParams({ agent: "web" });
  if (params.project_key) query.set("project_key", params.project_key);
  return apiRequest<{ compiled: CompiledMemoryDto }>(
    `/api/app/memory/compile?${query.toString()}`,
  );
}
