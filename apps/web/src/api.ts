import type {
  AppNotificationDto,
  AttachmentDto,
  CreateMemoInput,
  CreateMemoryInput,
  CreateProjectInput,
  CreateTaskInput,
  DailyReviewResponse,
  DataTaskDto,
  DeleteTagResponse,
  ImportResult,
  ListAppNotificationsResponse,
  ListMemosResponse,
  MemoContextResponse,
  MemoDto,
  MemoryDto,
  MemoryRelationDto,
  MemoryRevisionDto,
  MemoState,
  MemoStatsResponse,
  MemoVisibility,
  ProjectDto,
  PublicShareDto,
  RandomMemoResponse,
  RelatedMemosResponse,
  RenameTagResponse,
  ReviewWalkVia,
  ShareDto,
  TagHierarchyResponse,
  TaskActivityDto,
  TaskDto,
  TaskPriority,
  TaskStatus,
  UpdateMemoInput,
  UpdateMemoryInput,
  UpdateProjectInput,
  UpdateTaskInput,
  WalkNextResponse,
} from "@flaremo/contracts";

export type Attachment = AttachmentDto;
export type Memo = MemoDto;
export type MemoPayload = MemoDto["payload"];
export type Share = ShareDto;
export type PublicShare = PublicShareDto;
export type MemoContext = MemoContextResponse;
export type RelatedMemo = RelatedMemosResponse["memos"][number];
export type TagHierarchyNode = TagHierarchyResponse["tags"][number];
export type AppNotification = AppNotificationDto;
export type Memory = MemoryDto;
export type MemoryRevision = MemoryRevisionDto;
export type MemoryRelation = MemoryRelationDto;
export type { MemoState, MemoStatsResponse, MemoVisibility, ReviewWalkVia };

export type CreateMemoRequest = CreateMemoInput;
export type UpdateMemoRequest = UpdateMemoInput;
export type CreateMemoryRequest = CreateMemoryInput;
export type UpdateMemoryRequest = UpdateMemoryInput;

export type Project = ProjectDto;
export type Task = TaskDto;
export type TaskActivity = TaskActivityDto;
export type CreateProjectRequest = CreateProjectInput;
export type UpdateProjectRequest = UpdateProjectInput;
export type CreateTaskRequest = CreateTaskInput;
export type UpdateTaskRequest = UpdateTaskInput;
export type { TaskPriority, TaskStatus };

export type ListMemoParams = {
  state?: MemoState;
  q?: string;
  tag?: string;
  untagged?: boolean;
  include_deleted?: boolean;
  page_size?: number;
  page_token?: string;
};

export type ListAttachmentsResponse = {
  attachments: Attachment[];
};

export type AppInfo = {
  ok: true;
  product: "FlareMo";
  version: string;
  update_repository: string | null;
  update_workflow_url: string | null;
  releases_url: string;
  update_guide_url: string;
};

export type LatestRelease = {
  version: string;
  name: string;
  published_at: string | null;
  url: string;
};

export type BootstrapStatus = {
  initialized: boolean;
  state: "ready" | "complete" | "recovery_required";
  setup_available: boolean;
};

export type PersonalAccessToken = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_request: string | null;
  request_count: number;
  rate_limit_enabled: boolean;
  rate_limit_max: number | null;
  rate_limit_time_window: number | null;
};

export const AUTHENTICATION_REQUIRED_EVENT = "flaremo:authentication-required";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function listMemos(params: ListMemoParams = {}) {
  const query = new URLSearchParams();
  query.set("page_size", String(params.page_size ?? 30));
  query.set("order_by", "created_at desc");
  if (params.state) query.set("state", params.state);
  if (params.q) query.set("q", params.q);
  if (params.tag) query.set("tag", params.tag);
  if (params.untagged) query.set("untagged", "true");
  if (params.include_deleted) query.set("include_deleted", "true");
  if (params.page_token) query.set("page_token", params.page_token);

  return apiRequest<ListMemosResponse>(`/api/app/memos?${query.toString()}`);
}

export async function getTagHierarchy() {
  return apiRequest<TagHierarchyResponse>("/api/app/tags");
}

export async function renameTag(input: { from: string; to: string }) {
  return apiRequest<RenameTagResponse>("/api/app/tags", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTag(tag: string) {
  return apiRequest<DeleteTagResponse>(
    `/api/app/tags?tag=${encodeURIComponent(tag)}`,
    { method: "DELETE" },
  );
}

export async function getMemoStats(timeZone: string) {
  const query = new URLSearchParams({ time_zone: timeZone });
  return apiRequest<MemoStatsResponse>(`/api/app/stats?${query.toString()}`);
}

export async function getDailyReview(date: string, tzOffsetMinutes: number) {
  const query = new URLSearchParams({
    date,
    tzOffset: String(tzOffsetMinutes),
  });
  return apiRequest<DailyReviewResponse>(
    `/api/app/review/daily?${query.toString()}`,
  );
}

export async function getRandomWalkMemo(exclude: string[] = []) {
  const query = new URLSearchParams();
  if (exclude.length > 0) query.set("exclude", exclude.join(","));
  return apiRequest<RandomMemoResponse>(
    `/api/app/review/random?${query.toString()}`,
  );
}

export async function getWalkNextMemo(memoId: string, exclude: string[] = []) {
  const query = new URLSearchParams({ memoId });
  if (exclude.length > 0) query.set("exclude", exclude.join(","));
  return apiRequest<WalkNextResponse>(
    `/api/app/review/walk?${query.toString()}`,
  );
}

export async function getAppInfo() {
  return apiRequest<AppInfo>("/api/app/health");
}

export async function listNotifications() {
  const query = new URLSearchParams({ page_size: "50" });
  return apiRequest<ListAppNotificationsResponse>(
    `/api/app/notifications?${query.toString()}`,
  );
}

export async function archiveNotification(name: string) {
  const id = name.split("/").pop() ?? name;
  return apiRequest<AppNotification>(
    `/api/app/notifications/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
  );
}

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

export async function listMemories(params: ListMemoriesParams = {}) {
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

  return apiRequest<{ memories: Memory[] }>(
    `/api/app/memory?${query.toString()}`,
  );
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

export async function getMemory(id: string) {
  return apiRequest<{ memory: Memory }>(
    `/api/app/memory/${encodeURIComponent(id)}`,
  );
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

export async function listMemoryRelations(id: string) {
  return apiRequest<{ relations: MemoryRelation[] }>(
    `/api/app/memory/${encodeURIComponent(id)}/relations`,
  );
}

// --- Projects ---------------------------------------------------------------

export async function listProjects(
  params: { status?: Project["status"] } = {},
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<{ projects: Project[] }>(`/api/app/projects${suffix}`);
}

export async function createProject(input: CreateProjectRequest) {
  return apiRequest<{ project: Project }>("/api/app/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProject(id: string) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}`,
  );
}

export async function updateProject(id: string, input: UpdateProjectRequest) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function archiveProject(id: string, archived: boolean) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}/${
      archived ? "archive" : "unarchive"
    }`,
    { method: "POST" },
  );
}

export async function deleteProject(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/projects/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// --- Tasks ------------------------------------------------------------------

export async function listTasks(
  params: { project_id?: string; status?: Task["status"] } = {},
) {
  const query = new URLSearchParams();
  if (params.project_id) query.set("project_id", params.project_id);
  if (params.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<{ tasks: Task[] }>(`/api/app/tasks${suffix}`);
}

export async function createTask(input: CreateTaskRequest) {
  return apiRequest<{ task: Task }>("/api/app/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getTask(id: string) {
  return apiRequest<{ task: Task }>(`/api/app/tasks/${encodeURIComponent(id)}`);
}

export async function updateTask(id: string, input: UpdateTaskRequest) {
  return apiRequest<{ task: Task }>(
    `/api/app/tasks/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteTask(id: string) {
  return apiRequest<{ ok: true }>(`/api/app/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function reorderTasks(projectId: string, taskIds: string[]) {
  return apiRequest<{ tasks: Task[] }>("/api/app/tasks/reorder", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, task_ids: taskIds }),
  });
}

export async function listTaskActivity(id: string) {
  return apiRequest<{ activity: TaskActivity[] }>(
    `/api/app/tasks/${encodeURIComponent(id)}/activity`,
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

export async function getLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(
    "https://api.github.com/repos/realchendahuang/FlareMo/releases/latest",
    {
      credentials: "omit",
      headers: {
        accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status})`);
  }
  const release = (await response.json()) as {
    tag_name?: unknown;
    name?: unknown;
    published_at?: unknown;
  };
  const version =
    typeof release.tag_name === "string"
      ? release.tag_name.replace(/^v/, "")
      : "";
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("GitHub returned an invalid FlareMo release version");
  }
  return {
    version,
    name:
      typeof release.name === "string" && release.name
        ? release.name
        : `v${version}`,
    published_at:
      typeof release.published_at === "string" ? release.published_at : null,
    url: `https://github.com/realchendahuang/FlareMo/releases/tag/v${encodeURIComponent(version)}`,
  };
}

export async function getBootstrapStatus() {
  return apiRequest<BootstrapStatus>(
    "/api/auth/flaremo/bootstrap/status",
    {},
    {
      authRequired: false,
    },
  );
}

export async function bootstrapOwner(input: {
  username: string;
  name: string;
  email: string;
  password: string;
  bootstrapSecret: string;
}) {
  return apiRequest<{ ok: true }>(
    "/api/auth/flaremo/bootstrap",
    {
      method: "POST",
      headers: {
        "x-flaremo-bootstrap-secret": input.bootstrapSecret,
      },
      body: JSON.stringify({
        username: input.username,
        name: input.name,
        email: input.email,
        password: input.password,
      }),
    },
    { authRequired: false },
  );
}

export async function listPersonalAccessTokens() {
  return apiRequest<{ personal_access_tokens: PersonalAccessToken[] }>(
    "/api/app/account/personal-access-tokens",
  );
}

export async function createPersonalAccessToken(input: {
  name: string;
  expires_in_days?: number | null;
}) {
  return apiRequest<{
    personal_access_token: PersonalAccessToken;
    token: string;
  }>("/api/app/account/personal-access-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokePersonalAccessToken(id: string) {
  return apiRequest<{ personal_access_token: PersonalAccessToken }>(
    `/api/app/account/personal-access-tokens/${encodeURIComponent(id)}/revoke`,
    { method: "POST" },
  );
}

export async function createMemo(input: CreateMemoRequest) {
  return apiRequest<Memo>("/api/app/memos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemo(id: string, input: UpdateMemoRequest) {
  return apiRequest<Memo>(`/api/app/memos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashMemo(id: string) {
  return apiRequest<Memo>(`/api/app/memos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function hardDeleteMemo(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/memos/${encodeURIComponent(id)}?hard=true`,
    { method: "DELETE" },
  );
}

export async function uploadAttachment(input: {
  file: File;
  memo?: string;
  clientId?: string;
}) {
  const formData = new FormData();
  formData.set("file", input.file);
  if (input.memo) {
    formData.set("memo", input.memo);
  }
  if (input.clientId) {
    formData.set("client_id", input.clientId);
  }
  return apiRequest<Attachment>("/api/v1/attachments", {
    method: "POST",
    body: formData,
  });
}

export async function listMemoAttachments(memo: string) {
  return apiRequest<ListAttachmentsResponse>(
    `/api/v1/memos/${encodeURIComponent(memo)}/attachments`,
  );
}

export async function bindMemoAttachments(memo: string, attachments: string[]) {
  return apiRequest<ListAttachmentsResponse>(
    `/api/v1/memos/${encodeURIComponent(memo)}/attachments`,
    {
      method: "PATCH",
      body: JSON.stringify({ attachments }),
    },
  );
}

export async function createShare(memo: string) {
  return apiRequest<Share>(`/api/v1/memos/${encodeURIComponent(memo)}/shares`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getMemoContext(id: string) {
  return apiRequest<MemoContext>(`/api/app/memos/${encodeURIComponent(id)}`);
}

export async function getRelatedMemos(id: string) {
  return apiRequest<RelatedMemosResponse>(
    `/api/app/memos/${encodeURIComponent(id)}/related`,
  );
}

export async function revokeShare(id: string) {
  return apiRequest<Share>(`/api/v1/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function restoreMemoRevision(memo: string, revision: string) {
  return apiRequest<Memo>(
    `/api/v1/memos/${encodeURIComponent(memo)}/revisions/restore`,
    {
      method: "POST",
      body: JSON.stringify({ revision }),
    },
  );
}

export async function replaceMemoRelations(
  memo: string,
  relations: Array<{
    related_memo: string;
    type: "reference" | "comment";
  }>,
) {
  return apiRequest<{
    relations: MemoContext["relations"][number]["relation"][];
  }>(`/api/v1/memos/${encodeURIComponent(memo)}/relations`, {
    method: "PATCH",
    body: JSON.stringify({ relations }),
  });
}

export async function getPublicShare(token: string) {
  return apiRequest<PublicShare>(
    `/api/public/shares/${encodeURIComponent(token)}`,
    {},
    { authRequired: false },
  );
}

export async function createExportTask() {
  return apiRequest<{ task: DataTaskDto }>("/api/v1/export/tasks", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getDataTask(id: string) {
  return apiRequest<{ task: DataTaskDto }>(
    `/api/v1/export/tasks/${encodeURIComponent(id)}`,
  );
}

export async function createImportTask(input: {
  bundle: unknown;
  conflict?: "skip" | "duplicate" | "overwrite";
}) {
  return apiRequest<{ task: DataTaskDto; result: ImportResult }>(
    "/api/v1/import/tasks",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function downloadExportJson(id: string) {
  const response = await fetch(
    `/api/v1/export/tasks/${encodeURIComponent(id)}/manifest`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }
  return response.blob();
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { authRequired?: boolean } = {},
) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // The web app still consumes FlareMo's original snake_case DTOs for its
  // /api/v1 attachment, share, relation, import, and export helpers. Keep
  // that internal client explicit while external /api/v1 callers default to
  // the current Memos-compatible wire.
  if (path.startsWith("/api/v1/") && !headers.has("x-flaremo-wire")) {
    headers.set("x-flaremo-wire", "legacy");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let message = response.statusText;
    if (isJson) {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    }
    if (
      response.status === 401 &&
      options.authRequired !== false &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
    }
    throw new ApiError(message, response.status);
  }

  if (!isJson) {
    throw new ApiError("The server returned an unexpected response.", 502);
  }

  return (await response.json()) as T;
}
