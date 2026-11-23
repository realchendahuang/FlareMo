/**
 * Device-authorization (RFC 8628) and connected-app contracts.
 *
 * The user-facing "pairing code" is the wire `user_code`; the protocol itself
 * stays standard so an OAuth authorization-code flow can be added later
 * without replacing this one. See docs/agent-access-design.md.
 */

/** How long a pairing code stays valid after it is generated. */
export const DEVICE_CODE_TTL_SECONDS = 300;
/** Minimum polling interval the client must respect. */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
/** Lifetime of an issued access token. */
export const ACCESS_TOKEN_TTL_DAYS = 14;
/** Lifetime of a refresh token when it is not rotated for this long. */
export const REFRESH_TOKEN_TTL_DAYS = 90;
/** Upper bound on dynamic client registrations per instance. */
export const MAX_APP_CLIENTS = 50;
/** Upper bound on polling before a device authorization is abandoned. */
export const DEVICE_POLL_MAX_ATTEMPTS = 60;

/** RFC 8628 grant type for device authorization. */
export const DEVICE_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";
export const REFRESH_TOKEN_GRANT_TYPE = "refresh_token";

export const USER_CODE_LENGTH = 8;
/** No 0/O/1/I to keep the code readable when typed by hand. */
export const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const APP_CLIENT_TYPES = ["device", "web", "script"] as const;
export type AppClientType = (typeof APP_CLIENT_TYPES)[number];

export const DEVICE_AUTHORIZATION_STATUSES = [
  "pending",
  "approved",
  "redeemed",
  "expired",
] as const;
export type DeviceAuthorizationStatus =
  (typeof DEVICE_AUTHORIZATION_STATUSES)[number];

/** Error codes returned by the device/token endpoints (RFC 8628 §3.5). */
export const CONNECT_ERROR_CODES = {
  authorizationPending: "authorization_pending",
  slowDown: "slow_down",
  accessDenied: "access_denied",
  expiredToken: "expired_token",
  invalidGrant: "invalid_grant",
  invalidClient: "invalid_client",
  invalidRequest: "invalid_request",
  unsupportedGrantType: "unsupported_grant_type",
} as const;
export type ConnectErrorCode =
  (typeof CONNECT_ERROR_CODES)[keyof typeof CONNECT_ERROR_CODES];

/** Public shape of a client identity (never carries secrets). */
export type AppClientDto = {
  id: string;
  name: string;
  clientType: AppClientType;
  createdAt: string;
  lastSeenAt: string | null;
};

/** One row of the "connected apps" settings page. A connected app is an app
 * client plus the access token it currently holds. */
export type ConnectedAppDto = {
  /** `auth_apikeys.id` of the live access token; the revoke handle. */
  id: string;
  name: string;
  clientType: AppClientType | "manual";
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** 'active' | 'expired' */
  status: "active" | "expired";
};

/** Body accepted by POST /connect/device. */
export type DeviceAuthorizationRequestDto = {
  client_name: string;
  client_type: AppClientType;
  scopes?: string[];
};

/** Successful response of POST /connect/device. */
export type DeviceAuthorizationResponseDto = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

/** Successful token response of POST /connect/token. */
export type DeviceTokenResponseDto = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** Error envelope returned by the device endpoints (RFC 8628 §3.5). */
export type DeviceTokenErrorDto = {
  error: ConnectErrorCode;
  error_description?: string;
};

/** Body accepted by POST /api/app/connect/approve. */
export type ApproveDeviceAuthorizationDto = {
  user_code: string;
  scopes?: string[];
};

/** Response of the approve endpoint. */
export type ApproveDeviceAuthorizationResponseDto = {
  client_name: string;
  scopes: string[];
};

/** Response of GET /api/app/connect/apps. */
export type ConnectedAppsResponseDto = {
  apps: ConnectedAppDto[];
};

/** Normalize a typed pairing code: uppercase, strip separators and spaces. */
export function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}
