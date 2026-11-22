import {
  createUserWebhook,
  deleteUserWebhook,
  getUserWebhookSigningSecret,
  listUserWebhooks,
  updateUserWebhook,
} from "@flaremo/domain";
import { CompatValidationError } from "../../../memos-compat/errors";
import {
  fieldMaskPaths,
  optionalString,
  record,
  requiredString,
} from "../shared";
import { connectErrorForTransport, connectValue } from "../transport";
import { assertConnectUserPath, type ConnectUserMethodInput } from "./shared";

/**
 * The user-webhook surface. Reads stay available to any credential the caller
 * already holds, while creating, changing, deleting or revealing a webhook
 * secret requires a session.
 */
export async function connectUserWebhookMethod(
  input: ConnectUserMethodInput,
  method: string,
) {
  const { c, context, body, transport } = input;
  switch (method) {
    case "ListUserWebhooks":
      assertConnectUserPath(body.parent, context.user.id);
      return connectValue(
        c,
        { webhooks: await listUserWebhooks(context.db, context.user) },
        transport,
      );
    case "CreateUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to create a webhook",
          403,
        );
      }
      assertConnectUserPath(body.parent, context.user.id);
      const webhook = record(body.webhook);
      const signingSecret = webhook.signingSecret;
      if (signingSecret !== undefined && typeof signingSecret !== "string") {
        throw new CompatValidationError(
          "webhook.signingSecret must be a string",
        );
      }
      return connectValue(
        c,
        {
          ...(await createUserWebhook(context.db, context.user, {
            url: requiredString(webhook.url, "webhook.url"),
            displayName: optionalString(webhook.displayName) ?? "",
            ...(signingSecret !== undefined ? { signingSecret } : {}),
          })),
        },
        transport,
      );
    }
    case "UpdateUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update a webhook",
          403,
        );
      }
      const webhook = record(body.webhook);
      const url = webhook.url;
      if (url !== undefined && typeof url !== "string") {
        throw new CompatValidationError("webhook.url must be a string");
      }
      const displayName = webhook.displayName;
      if (displayName !== undefined && typeof displayName !== "string") {
        throw new CompatValidationError("webhook.displayName must be a string");
      }
      const signingSecret = webhook.signingSecret;
      if (signingSecret !== undefined && typeof signingSecret !== "string") {
        throw new CompatValidationError(
          "webhook.signingSecret must be a string",
        );
      }
      return connectValue(
        c,
        await updateUserWebhook(context.db, context.user, {
          name: requiredString(webhook.name, "webhook.name"),
          ...(url !== undefined ? { url } : {}),
          ...(displayName !== undefined ? { displayName } : {}),
          ...(signingSecret !== undefined ? { signingSecret } : {}),
          updateMask: fieldMaskPaths(body.updateMask),
        }),
        transport,
      );
    }
    case "DeleteUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to delete a webhook",
          403,
        );
      }
      await deleteUserWebhook(
        context.db,
        context.user,
        requiredString(body.name, "name"),
      );
      return connectValue(c, {}, transport);
    }
    case "GetUserWebhookSigningSecret": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to reveal a webhook secret",
          403,
        );
      }
      return connectValue(
        c,
        {
          signingSecret: await getUserWebhookSigningSecret(
            context.db,
            context.user,
            requiredString(body.name, "name"),
          ),
        },
        transport,
      );
    }
  }
}
