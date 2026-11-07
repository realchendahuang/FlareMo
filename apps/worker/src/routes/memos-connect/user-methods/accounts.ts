import { listMemosPersonalAccessTokens } from "@flaremo/domain";
import { getFlareMoAuth } from "../../../context";
import { CompatValidationError } from "../../../memos-compat/errors";
import {
  createMemosPersonalAccessToken,
  personalAccessTokenToDto,
} from "../../../memos-compat/pat";
import { optionalString, requiredString } from "../shared";
import { connectErrorForTransport, connectValue } from "../transport";
import {
  assertConnectPatPath,
  assertConnectUserPath,
  type ConnectUserMethodInput,
} from "./shared";

/**
 * The personal-access-token surface. A PAT cannot manage PATs — minting or
 * revoking one has to go through a session credential — and every name is
 * checked against the calling user before it is read or disabled.
 */
export async function connectUserAccountMethod(
  input: ConnectUserMethodInput,
  method: string,
) {
  const { c, context, body, transport } = input;
  switch (method) {
    case "ListPersonalAccessTokens": {
      assertConnectUserPath(body.parent, context.user.id);
      const tokens = await listMemosPersonalAccessTokens(
        context.db,
        context.authUserId,
      );
      return connectValue(
        c,
        {
          personalAccessTokens: tokens.map((token) =>
            personalAccessTokenToDto(token, context.user.id),
          ),
          totalSize: tokens.length,
        },
        transport,
      );
    }
    case "CreatePersonalAccessToken": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to create a PAT",
          403,
        );
      }
      assertConnectUserPath(body.parent, context.user.id);
      // Omitted means the server's finite default. Explicit 0 is the upstream
      // wire spelling for "never expires" and is allowed only for notes scope.
      const expiresInDays =
        body.expiresInDays === undefined
          ? undefined
          : Number(body.expiresInDays);
      if (
        expiresInDays !== undefined &&
        (!Number.isInteger(expiresInDays) ||
          expiresInDays < 0 ||
          expiresInDays > 365)
      ) {
        throw new CompatValidationError(
          "expiresInDays must be an integer between 0 and 365",
        );
      }
      const created = await createMemosPersonalAccessToken(
        await getFlareMoAuth(c.env),
        {
          userId: context.authUserId,
          name: optionalString(body.description),
          // Explicit 0 is the upstream wire contract for a non-expiring token.
          expiresInDays,
        },
      );
      return connectValue(
        c,
        {
          personalAccessToken: personalAccessTokenToDto(
            created,
            context.user.id,
          ),
          token: created.key,
        },
        transport,
      );
    }
    case "DeletePersonalAccessToken": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to revoke a PAT",
          403,
        );
      }
      assertConnectPatPath(body.name, context.user.id);
      const tokenId = requiredString(body.name, "name").split("/").at(-1) ?? "";
      const token = (
        await listMemosPersonalAccessTokens(context.db, context.authUserId)
      ).find((item) => item.id === tokenId);
      if (!token)
        throw new CompatValidationError("Personal access token not found");
      await (await getFlareMoAuth(c.env)).api.updateApiKey({
        body: {
          configId: "memos",
          keyId: token.id,
          userId: context.authUserId,
          enabled: false,
        },
      });
      return connectValue(c, {}, transport);
    }
  }
}
