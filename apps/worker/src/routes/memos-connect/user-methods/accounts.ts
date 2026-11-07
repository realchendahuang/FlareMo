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
      const expiresInDays =
        body.expiresInDays === undefined ? 0 : Number(body.expiresInDays);
      if (
        !Number.isInteger(expiresInDays) ||
        expiresInDays < 0 ||
        expiresInDays > 365
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
          // 0 is the compatibility spelling for "use the server default".
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
