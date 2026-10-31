import type {
  AppNotificationDto,
  ArticleDto,
  ArticleSummaryDto,
  AttachmentDto,
  CalendarView,
  CompiledMemoryDto,
  CreateArticleInput,
  CreateMemoInput,
  CreateMemoryInput,
  CreateProjectInput,
  CreateTaskInput,
  MemoContextResponse,
  MemoDto,
  MemoryDto,
  MemoryRevisionDto,
  MemoState,
  MemoStatsResponse,
  MemoVisibility,
  ProjectDto,
  PublicShareDto,
  RelatedMemosResponse,
  ReviewSettingsResponse,
  ReviewWalkVia,
  ShareDto,
  TagHierarchyResponse,
  TaskDto,
  TaskPriority,
  TaskStatus,
  TodayReviewItem,
  TodayReviewReason,
  UpdateArticleInput,
  UpdateMemoInput,
  UpdateMemoryInput,
  UpdateProjectInput,
  UpdateTaskInput,
  VectorUsageReport,
} from "@flaremo/contracts";

export type Attachment = AttachmentDto;
export type Memo = MemoDto;
export type Share = ShareDto;
export type PublicShare = PublicShareDto;
export type MemoContext = MemoContextResponse;
export type RelatedMemo = RelatedMemosResponse["memos"][number];
export type TagHierarchyNode = TagHierarchyResponse["tags"][number];
export type AppNotification = AppNotificationDto;
export type Memory = MemoryDto;
export type { CompiledMemoryDto };
export type MemoryRevision = MemoryRevisionDto;
export type {
  MemoState,
  MemoStatsResponse,
  MemoVisibility,
  ReviewSettingsResponse,
  ReviewWalkVia,
  TodayReviewItem,
  TodayReviewReason,
  VectorUsageReport,
};

// Deployment-specific: Cloudflare account analytics reported by the worker
// (see apps/worker/src/cf-analytics.ts). Owner-only, hidden until
// `pnpm setup:usage` writes the analytics secrets.
export type CloudflareUsageReport = {
  available: boolean;
  window: { since: string; until: string };
  errors: string[];
  workers: { requests: number; subrequests: number; errors: number } | null;
  d1: {
    storageBytes: number | null;
    rowsRead: number;
    rowsWritten: number;
  } | null;
  r2: {
    storageBytes: number | null;
    objectCount: number | null;
    classAOps: number;
    classBOps: number;
  } | null;
};

export type CreateMemoRequest = CreateMemoInput;
export type UpdateMemoRequest = UpdateMemoInput;
export type CreateMemoryRequest = CreateMemoryInput;
export type UpdateMemoryRequest = UpdateMemoryInput;

export type Project = ProjectDto;
export type Task = TaskDto;
export type Article = ArticleDto;
export type ArticleSummary = ArticleSummaryDto;
export type CreateArticleRequest = CreateArticleInput;
export type UpdateArticleRequest = UpdateArticleInput;
export type Calendar = CalendarView;
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
  space?: MemoSpace;
};

export type AppInfo = {
  ok: true;
  product: string;
  version: string;
  update_repository: string | null;
  update_workflow_url: string | null;
  releases_url: string;
  update_guide_url: string;
  email_provider?: string;
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

export type RegistrationStatus = {
  registration_open: boolean;
  initialized: boolean;
  email_verification_required: boolean;
  captcha: {
    provider: "none" | "tencent" | "http";
    site_key: string | null;
  };
};

export type CurrentFlareMoUser = {
  id: string;
  role: "owner" | "admin" | "member" | "reader" | null;
  is_instance_owner: boolean;
  can_manage_voice_service: boolean;
  status: "active" | "removed";
  name: string;
  email: string;
  username: string;
  avatar_url?: string | null;
  /** Present when the viewer holds an unexpired team membership; drives the space UI. */
  team: {
    id: string;
    name: string;
    /** Seats in the organization, owner included (older servers omit it). */
    member_count?: number;
  } | null;
  /** True when a reader seat exists but has lapsed: the team space is hidden and a renewal notice shows instead. */
  team_expired?: boolean;
  /** Absolute expiry of the viewer's own reader seat (ISO string); null = seat without expiry. Present for readers only. */
  reader_expires_at?: string | null;
};

/** Workspace partition of the memo corpus (see docs/team-space-ux.md). */
export type MemoSpace = "all" | "personal" | "team";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar_url?: string | null;
  role: "owner" | "admin" | "member" | "reader" | null;
  /** Absolute expiry of the reader seat (ISO string), null when not a reader or the seat has no expiry. */
  reader_expires_at: string | null;
  status: "active" | "removed";
  created_at: string;
};
