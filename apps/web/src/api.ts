export type MemoVisibility = "private" | "protected" | "public";
export type MemoState = "normal" | "archived" | "trashed" | "deleted";

export type MemoPayload = {
  tags?: string[];
  property?: {
    title?: string;
    has_link?: boolean;
    has_task_list?: boolean;
    has_code?: boolean;
    has_incomplete_tasks?: boolean;
  };
  location?: unknown;
  client_id?: string;
  [key: string]: unknown;
};

export type Memo = {
  name: string;
  id: string;
  content: string;
  visibility: MemoVisibility;
  state: MemoState;
  pinned: boolean;
  payload: MemoPayload;
  create_time: string;
  update_time: string;
  display_time: string;
  creator: string;
  attachments?: Attachment[];
};

export type Attachment = {
  name: string;
  id: string;
  memo: string | null;
  filename: string;
  content_type: string | null;
  size: number;
  payload: Record<string, unknown>;
  create_time: string;
  update_time: string;
  download_url: string;
};

export type Share = {
  name: string;
  id: string;
  memo: string;
  token: string;
  expires_at: string | null;
  create_time: string;
};

export type PublicShare = {
  share: Omit<Share, "token">;
  memo: Memo;
  attachments: Attachment[];
};

export type ListMemosResponse = {
  memos: Memo[];
  next_page_token?: string;
};

export type ListAttachmentsResponse = {
  attachments: Attachment[];
};

export type CreateMemoRequest = {
  content: string;
  visibility?: MemoVisibility;
  payload?: MemoPayload;
  source?: string;
};

export type UpdateMemoRequest = Partial<{
  content: string;
  visibility: MemoVisibility;
  status: MemoState;
  pinned: boolean;
  payload: MemoPayload;
}>;

export type ListMemoParams = {
  state?: MemoState;
  q?: string;
  tag?: string;
  include_deleted?: boolean;
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
  query.set("page_size", "50");
  query.set("order_by", "created_at desc");
  if (params.state) query.set("state", params.state);
  if (params.q) query.set("q", params.q);
  if (params.tag) query.set("tag", params.tag);
  if (params.include_deleted) query.set("include_deleted", "true");

  return apiRequest<ListMemosResponse>(`/api/app/memos?${query.toString()}`);
}

export async function createMemo(input: CreateMemoRequest) {
  return apiRequest<Memo>("/api/app/memos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemo(id: string, input: UpdateMemoRequest) {
  return apiRequest<Memo>(`/api/app/memos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashMemo(id: string) {
  return apiRequest<Memo>(`/api/app/memos/${id}`, {
    method: "DELETE",
  });
}

export async function hardDeleteMemo(id: string) {
  return apiRequest<{ ok: true }>(`/api/app/memos/${id}?hard=true`, {
    method: "DELETE",
  });
}

export async function uploadAttachment(input: { file: File; memo?: string }) {
  const formData = new FormData();
  formData.set("file", input.file);
  if (input.memo) {
    formData.set("memo", input.memo);
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
    {
      method: "DELETE",
    },
  );
}

export async function createShare(memo: string) {
  return apiRequest<Share>(`/api/v1/memos/${encodeURIComponent(memo)}/shares`, {
    method: "POST",
    body: JSON.stringify({}),
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
  return apiRequest<{
    imported_memos: number;
    imported_attachments: number;
    imported_relations: number;
    imported_shares: number;
  }>("/api/v1/import", {
    method: "POST",
    body: JSON.stringify(bundle),
  });
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
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
    throw new ApiError(message, response.status);
  }

  if (!isJson) {
    throw new ApiError("Cloudflare Access session required", 401);
  }

  return (await response.json()) as T;
}
