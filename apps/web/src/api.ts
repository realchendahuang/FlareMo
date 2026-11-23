// Barrel: re-exports every domain module so callers keep importing from
// "@/api" exactly as before the split. The low-level apiRequest helper stays
// internal to ./api/client and is intentionally not re-exported.

export * from "./api/account";
export * from "./api/articles";
export * from "./api/attachments";
export * from "./api/auth";
export * from "./api/branding";
export * from "./api/capture";
export { ApiError, AUTHENTICATION_REQUIRED_EVENT } from "./api/client";
export * from "./api/connect";
export * from "./api/data-tasks";
export * from "./api/insights";
export * from "./api/integrations";
export * from "./api/memos";
export * from "./api/notifications";
export * from "./api/plugins";
export * from "./api/projects";
export * from "./api/push";
export * from "./api/releases";
export * from "./api/shares";
export * from "./api/types";
export * from "./api/voice";
