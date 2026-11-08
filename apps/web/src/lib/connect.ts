import { type ConnectedAppDto, USER_CODE_LENGTH } from "@flaremo/contracts";
import type { TranslationKey } from "@/i18n";

/**
 * Shared formatting for the device-authorization surfaces: the 8-character
 * pairing code is stored raw and only shown as `XXXX-XXXX`, and the DTO's
 * scope/client-type enums map to translation keys in one place so the approval
 * page and the settings list cannot drift.
 */

/** Uppercase, drop spaces and dashes, keep the code alphabet, cap at 8. */
export function normalizePairingCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, USER_CODE_LENGTH);
}

/** `ABCDEFGH` renders as `ABCD-EFGH`; partial input keeps its raw shape. */
export function formatPairingCode(value: string): string {
  const normalized = normalizePairingCode(value);
  return normalized.length > 4
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}

const SCOPE_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  notes: "connect.scope.notes",
  admin: "connect.scope.admin",
};

const SCOPE_DETAIL_KEYS: Partial<Record<string, TranslationKey>> = {
  notes: "connect.scope.notesDetail",
  admin: "connect.scope.adminDetail",
};

/** A known scope's short label, or the raw scope name for future scopes. */
export function scopeLabel(
  scope: string,
  t: (key: TranslationKey) => string,
): string {
  const key = SCOPE_LABEL_KEYS[scope];
  return key ? t(key) : scope;
}

/** One-line explanation of a known scope; unknown scopes have none. */
export function scopeDetail(
  scope: string,
  t: (key: TranslationKey) => string,
): string | null {
  const key = SCOPE_DETAIL_KEYS[scope];
  return key ? t(key) : null;
}

const CLIENT_TYPE_KEYS: Record<ConnectedAppDto["clientType"], TranslationKey> =
  {
    device: "connect.clientType.device",
    web: "connect.clientType.web",
    script: "connect.clientType.script",
    manual: "connect.clientType.manual",
  };

export function clientTypeLabel(
  clientType: ConnectedAppDto["clientType"],
  t: (key: TranslationKey) => string,
): string {
  return t(CLIENT_TYPE_KEYS[clientType]);
}
