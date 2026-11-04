import { apiRequest } from "./client";
import type {
  AdminUser,
  CurrentFlareMoUser,
  PersonalAccessToken,
} from "./types";

export async function deleteAccount(currentPassword: string) {
  return apiRequest<{ ok: true }>("/api/app/account", {
    method: "DELETE",
    body: JSON.stringify({ current_password: currentPassword }),
  });
}

export async function getCurrentFlareMoUser() {
  return apiRequest<CurrentFlareMoUser>("/api/app/me");
}

export async function updateCurrentUserProfile(input: {
  name?: string;
  avatar_url?: string | null;
}) {
  return apiRequest<{
    ok: true;
    user: { id: string; name: string; avatar_url: string | null };
  }>("/api/app/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function uploadAvatar(file: File) {
  return apiRequest<{ ok: true; avatar_url: string }>("/api/app/me/avatar", {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "image/webp",
    },
    body: file,
  });
}

export async function deleteAvatar() {
  return apiRequest<{ ok: true; avatar_url: null }>("/api/app/me/avatar", {
    method: "DELETE",
  });
}

export async function listAdminUsers() {
  return apiRequest<{ users: AdminUser[] }>("/api/app/admin/users");
}

export async function createAdminUser(input: { name: string; email: string }) {
  return apiRequest<
    AdminUser & {
      activation_path: string;
      activation_expires_in_seconds: number;
    }
  >("/api/app/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteAdminUser(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/admin/users/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

export async function updateAdminUserRole(
  id: string,
  role: "admin" | "member",
) {
  return apiRequest<AdminUser>(
    `/api/app/admin/users/${encodeURIComponent(id)}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}

/** Grant or renew the read-only reader seat. Pass an absolute expiry or null for a seat without one. */
export async function setAdminUserReader(id: string, expiresAt: string | null) {
  return apiRequest<AdminUser>(
    `/api/app/admin/users/${encodeURIComponent(id)}/reader`,
    {
      method: "PUT",
      body: JSON.stringify({ expires_at: expiresAt }),
    },
  );
}

export async function revokeAdminUserReader(id: string) {
  return apiRequest<AdminUser>(
    `/api/app/admin/users/${encodeURIComponent(id)}/reader`,
    {
      method: "DELETE",
    },
  );
}

export async function requestAdminPasswordReset(id: string) {
  return apiRequest<{
    token: string;
    reset_path: string;
    expires_in_seconds: number;
  }>(`/api/app/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
  });
}

export async function listPersonalAccessTokens() {
  return apiRequest<{ personal_access_tokens: PersonalAccessToken[] }>(
    "/api/app/account/personal-access-tokens",
  );
}

export async function createPersonalAccessToken(input: {
  name: string;
  expires_in_days?: number | null;
  scopes?: import("@flaremo/contracts").MemosPatScope[];
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

export async function deletePersonalAccessToken(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/account/personal-access-tokens/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function changeEmail(input: {
  current_password: string;
  new_email: string;
}) {
  return apiRequest<{ ok: true; verification_sent?: boolean }>(
    "/api/app/account/email",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
