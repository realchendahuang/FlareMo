import type {
  AttachmentDto,
  CreateMemoInput,
  ImportResult,
  ListMemosResponse,
  MemoContextResponse,
  MemoDto,
  MemoState,
  MemoStatsResponse,
  MemoVisibility,
  PublicShareDto,
  ShareDto,
  UpdateMemoInput,
} from "@flaremo/contracts";

export type Attachment = AttachmentDto;
export type Memo = MemoDto;
export type MemoPayload = MemoDto["payload"];
export type Share = ShareDto;
export type PublicShare = PublicShareDto;
export type MemoContext = MemoContextResponse;
export type { MemoState, MemoStatsResponse, MemoVisibility };

export type CreateMemoRequest = CreateMemoInput;
export type UpdateMemoRequest = UpdateMemoInput;

export type ListMemoParams = {
  state?: MemoState;
  q?: string;
  tag?: string;
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
  if (params.include_deleted) query.set("include_deleted", "true");
  if (params.page_token) query.set("page_token", params.page_token);

  return apiRequest<ListMemosResponse>(`/api/app/memos?${query.toString()}`);
}

export async function getMemoStats(timeZone: string) {
  const query = new URLSearchParams({ time_zone: timeZone });
  return apiRequest<MemoStatsResponse>(`/api/app/stats?${query.toString()}`);
}

export async function getAppInfo() {
  return apiRequest<AppInfo>("/api/app/health");
}

export async function getLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(
    "https://api.github.com/repos/realchendahuang/FlareMo/releases/latest",
    {
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

export async function deleteAttachment(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/v1/attachments/${encodeURIComponent(id)}`,
    { method: "DELETE" },
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
  );
}

export async function exportData() {
  return apiRequest<unknown>("/api/v1/export");
}

export async function importData(bundle: unknown) {
  return apiRequest<ImportResult>("/api/v1/import", {
    method: "POST",
    body: JSON.stringify(bundle),
  });
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let message = response.statusText;
    if (isJson) {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    }
    throw new ApiError(message, response.status);
  }

  if (!isJson) {
    throw new ApiError("Cloudflare Access session required", 401);
  }

  return (await response.json()) as T;
}
