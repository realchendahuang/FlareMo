import type { FlareMoDb } from "@flaremo/db";
import { OWNER_FLAREMO_USER_ID } from "./auth";
import { NotFoundError } from "./errors";
import { getStoredSetting, upsertStoredSetting } from "./settings";
import { getFlaremoUserById } from "./users";

const REGISTRATION_SETTING_KEY = "memos.instance.GENERAL";

/**
 * Whether public self-registration is open. The owner's Memos instance
 * `GENERAL` setting is the single source of truth so the Web, REST, and
 * Connect surfaces all observe the same switch. Registration is closed by
 * default and remains closed until an owner opts in.
 */
export async function getUserRegistrationAllowed(
  db: FlareMoDb,
): Promise<boolean> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) return false;

  const stored = await getStoredSetting(db, owner, REGISTRATION_SETTING_KEY);
  const general = readGeneralSettingValue(stored?.value);
  return general.disallowUserRegistration === false;
}

/**
 * Set the public self-registration switch. Other `GENERAL` fields are
 * preserved so toggling registration does not clobber password-auth or
 * username-policy settings a Memos client may have written.
 */
export async function setUserRegistrationAllowed(
  db: FlareMoDb,
  allowed: boolean,
): Promise<void> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) throw new NotFoundError("Owner not found");

  const stored = await getStoredSetting(db, owner, REGISTRATION_SETTING_KEY);
  const existing = readGeneralSettingValue(stored?.value);
  await upsertStoredSetting(db, owner, REGISTRATION_SETTING_KEY, {
    case: "generalSetting",
    value: { ...existing, disallowUserRegistration: !allowed },
  });
}

function readGeneralSettingValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const nested = (value as Record<string, unknown>).value;
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}
