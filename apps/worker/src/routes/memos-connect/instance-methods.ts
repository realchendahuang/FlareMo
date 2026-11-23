import { FLAREMO_API_VERSION } from "@flaremo/contracts/constants";
import {
  getAuthBootstrapStatus,
  getMemoStats,
  getStoredSetting,
  isInstanceOwner,
  upsertStoredSetting,
} from "@flaremo/domain";
import { currentUserToDto, publicUserToDto } from "@flaremo/memos";
import { getAuthUserCached } from "../../identity-cache";
import { CompatValidationError } from "../../memos-compat/errors";
import type { BinaryTransport } from "../../memos-protobuf";
import {
  type ConnectContext,
  type ConnectRequestContext,
  connectSettingRecord,
  list,
  record,
  requiredString,
} from "./shared";
import { connectErrorForTransport, connectValue } from "./transport";

export async function connectInstanceMethod(
  c: ConnectContext,
  context: ConnectRequestContext,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  switch (method) {
    case "GetInstanceProfile": {
      let admin:
        | ReturnType<typeof currentUserToDto>
        | ReturnType<typeof publicUserToDto>;
      let needsSetup = false;
      try {
        const bootstrap = await getAuthBootstrapStatus(context.db);
        needsSetup = bootstrap.state !== "complete";
        admin = context.authUserId
          ? currentUserToDto(
              context.user,
              await getAuthUserCached(context.db, context.authUserId),
            )
          : publicUserToDto(context.user);
      } catch {
        const timestamp = new Date(0).toISOString();
        admin = {
          name: "users/owner",
          role: "ADMIN" as const,
          username: "owner",
          displayName: c.env.FLAREMO_SINGLE_USER_NAME ?? "Owner",
          state: "NORMAL" as const,
          createTime: timestamp,
          updateTime: timestamp,
        };
      }
      return connectValue(
        c,
        {
          version: FLAREMO_API_VERSION,
          demo: false,
          instanceUrl: c.env.FLAREMO_PUBLIC_URL ?? new URL(c.req.url).origin,
          admin,
          needsSetup,
        },
        transport,
      );
    }
    case "GetInstanceSetting": {
      const name = requiredString(body.name, "name");
      if (!context.authUserId && !isPublicInstanceSettingKey(name)) {
        return connectErrorForTransport(
          c,
          transport,
          "unauthenticated",
          "This instance setting requires authentication",
          401,
        );
      }
      return connectValue(
        c,
        await instanceSettingResponse(context, name),
        transport,
      );
    }
    case "BatchGetInstanceSettings": {
      const names = list(body.names).map((name) =>
        requiredString(name, "names[]"),
      );
      if (names.length > 20) {
        return connectErrorForTransport(
          c,
          transport,
          "invalid_argument",
          "A maximum of 20 instance settings may be requested",
          400,
        );
      }
      if (
        !context.authUserId &&
        names.some((name) => !isPublicInstanceSettingKey(name))
      ) {
        return connectErrorForTransport(
          c,
          transport,
          "unauthenticated",
          "One or more instance settings require authentication",
          401,
        );
      }
      const settings = await Promise.all(
        names.map((name) => instanceSettingResponse(context, name)),
      );
      return connectValue(c, { settings }, transport);
    }
    case "UpdateInstanceSetting": {
      if (context.credential === "pat" || !isInstanceOwner(context.user)) {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update instance settings",
          403,
        );
      }
      const setting = connectSettingRecord(body.setting);
      const name = requiredString(setting.name, "setting.name");
      const key = instanceSettingKey(name);
      await upsertStoredSetting(
        context.db,
        context.user,
        `memos.instance.${key}`,
        setting.value,
      );
      return connectValue(c, setting, transport);
    }
    case "GetInstanceStats": {
      const stats = await getMemoStats(context.db, context.user, {
        time_zone: "UTC",
      });
      return connectValue(
        c,
        {
          database: { driver: "sqlite", sizeBytes: "-1" },
          localStorageBytes: "-1",
          generatedTime: new Date().toISOString(),
          memoCount: stats.counts.total,
        },
        transport,
      );
    }
    case "TestInstanceEmailSetting":
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        "Email delivery is not configured on FlareMo",
        501,
      );
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `Instance method is not implemented: ${method}`,
        501,
      );
  }
}

export async function connectIdentityProviderMethod(
  c: ConnectContext,
  _context: ConnectRequestContext,
  method: string,
  _value: unknown,
  transport?: BinaryTransport,
) {
  if (method === "ListIdentityProviders") {
    return connectValue(c, { identityProviders: [] }, transport);
  }
  return connectErrorForTransport(
    c,
    transport,
    "unimplemented",
    "Identity providers are not configured on FlareMo",
    501,
  );
}
function instanceSettingKey(name: string) {
  const key = name.split("/").at(-1)?.toUpperCase();
  if (!key || !/^[A-Z_]+$/.test(key)) {
    throw new CompatValidationError("Invalid instance setting name");
  }
  return key;
}

async function instanceSettingResponse(
  context: ConnectRequestContext,
  name: string,
) {
  if (!name.startsWith("instance/settings/")) {
    throw new CompatValidationError("Invalid instance setting name");
  }
  const key = instanceSettingKey(name);
  const stored = await getStoredSetting(
    context.db,
    context.user,
    `memos.instance.${key}`,
  );
  if (!context.authUserId) {
    return {
      name,
      value: publicInstanceSettingValue(key, stored?.value),
    };
  }
  return {
    name,
    value:
      stored?.value && typeof stored.value === "object"
        ? stored.value
        : defaultInstanceSetting(key),
  };
}

function isPublicInstanceSettingKey(name: string) {
  if (!name.startsWith("instance/settings/")) return false;
  const key = name.split("/").at(-1)?.toUpperCase();
  return key === "GENERAL" || key === "MEMO_RELATED";
}

function publicInstanceSettingValue(key: string, value: unknown) {
  const stored = record(record(value).value);
  if (key === "GENERAL") {
    return {
      case: "generalSetting",
      value: {
        disallowUserRegistration:
          typeof stored.disallowUserRegistration === "boolean"
            ? stored.disallowUserRegistration
            : true,
        disallowPasswordAuth:
          typeof stored.disallowPasswordAuth === "boolean"
            ? stored.disallowPasswordAuth
            : false,
        disallowChangeUsername:
          typeof stored.disallowChangeUsername === "boolean"
            ? stored.disallowChangeUsername
            : false,
        disallowChangeNickname:
          typeof stored.disallowChangeNickname === "boolean"
            ? stored.disallowChangeNickname
            : false,
      },
    };
  }
  if (key === "MEMO_RELATED") {
    const reactions = Array.isArray(stored.reactions)
      ? stored.reactions.filter(
          (reaction): reaction is string =>
            typeof reaction === "string" && reaction.length <= 32,
        )
      : ["👍", "❤️", "😂", "😢", "😡"];
    return {
      case: "memoRelatedSetting",
      value: {
        contentLengthLimit:
          typeof stored.contentLengthLimit === "number" &&
          Number.isSafeInteger(stored.contentLengthLimit) &&
          stored.contentLengthLimit > 0
            ? Math.min(stored.contentLengthLimit, 10_000_000)
            : 1_000_000,
        enableDoubleClickEdit:
          typeof stored.enableDoubleClickEdit === "boolean"
            ? stored.enableDoubleClickEdit
            : true,
        reactions: reactions.slice(0, 64),
      },
    };
  }
  throw new CompatValidationError(
    "This instance setting requires authentication",
  );
}

function defaultInstanceSetting(key: string) {
  switch (key) {
    case "GENERAL":
      return {
        case: "generalSetting",
        value: {
          disallowUserRegistration: true,
          disallowPasswordAuth: false,
          disallowChangeUsername: false,
          disallowChangeNickname: false,
        },
      };
    case "MEMO_RELATED":
      return {
        case: "memoRelatedSetting",
        value: {
          contentLengthLimit: 1_000_000,
          enableDoubleClickEdit: true,
          reactions: ["👍", "❤️", "😂", "😢", "😡"],
        },
      };
    case "STORAGE":
      return {
        case: "storageSetting",
        value: {
          storageType: "S3",
          filepathTemplate: "memos/{timestamp}_{filename}",
        },
      };
    case "NOTIFICATION":
      return {
        case: "notificationSetting",
        value: { email: { enabled: false } },
      };
    case "AI":
      return { case: "aiSetting", value: { providers: [] } };
    case "TAGS":
      return { case: "tagsSetting", value: { tags: {} } };
    default:
      throw new CompatValidationError(`Unsupported instance setting: ${key}`);
  }
}
