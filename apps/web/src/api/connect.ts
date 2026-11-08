import type {
  ApproveDeviceAuthorizationDto,
  ApproveDeviceAuthorizationResponseDto,
  ConnectedAppsResponseDto,
} from "@flaremo/contracts";
import { apiRequest } from "./client";

/**
 * Device authorization (RFC 8628) browser surface: the signed-in user approves
 * a pairing code, then sees and can revoke the apps that hold a token.
 *
 * The approve and inventory endpoints require the browser cookie session; a
 * PAT is rejected by the Worker, so these helpers never run from a script.
 */

/** Approve a pairing code for the current browser session. */
export async function approveDeviceAuthorization(
  input: ApproveDeviceAuthorizationDto,
) {
  return apiRequest<ApproveDeviceAuthorizationResponseDto>(
    "/api/app/connect/approve",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

/** Every app client and manual token connected to the current account. */
export async function listConnectedApps() {
  return apiRequest<ConnectedAppsResponseDto>("/api/app/connect/apps");
}

/** Revoke one connected app's access token and its refresh tokens (204). */
export async function revokeConnectedApp(id: string) {
  await apiRequest<undefined>(
    `/api/app/connect/apps/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
