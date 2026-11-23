import {
  ForbiddenError,
  getAuthBootstrapStatus,
  getFlaremoUserByAuthSessionToken,
  getUserRegistrationAllowed,
  revokeAuthSessionByToken,
  SELF_HOST_UNLIMITED,
} from "@flaremo/domain";
import { currentUserToDto } from "@flaremo/memos";
import { verifyCaptchaRequest } from "../../captcha";
import {
  assertTrustedCookieMutation,
  getFlareMoAuth,
  getFlareMoDb,
  type getRequestContext,
} from "../../context";
import { resolveEmailSendConfig } from "../../email";
import { getAuthUserCached } from "../../identity-cache";
import {
  isBetterAuthCredentialError,
  splitBearerToken,
} from "../../memos-compat/credential";
import { CompatValidationError } from "../../memos-compat/errors";
import {
  clearMemosRefreshCookie,
  issueMemosNativeTokens,
  revokeMemosRefreshToken,
  rotateMemosRefreshToken,
} from "../../memos-native-auth";
import type { BinaryTransport } from "../../memos-protobuf";
import { rateLimitGuard } from "../../rate-limit";
import {
  type ConnectContext,
  optionalString,
  record,
  requiredString,
} from "./shared";
import {
  connectError,
  connectErrorForTransport,
  connectErrorFrom,
  connectValue,
} from "./transport";
import { createConnectUser } from "./user-methods";

export async function connectAuthSignIn(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  try {
    // Credential brute-force surface: same per-IP edge bucket as /api/auth/*.
    const throttled = await rateLimitGuard(c, "auth");
    if (throttled) return throttled;
    assertTrustedCookieMutation(c);
    const credentials = record(record(value).passwordCredentials);
    const username = requiredString(credentials.username, "username");
    const password = requiredString(credentials.password, "password");
    const db = getFlareMoDb(c.env);
    const auth = await getFlareMoAuth(c.env);
    const result = await auth.api.signInUsername({
      body: { username, password, rememberMe: true },
      headers: c.req.raw.headers,
      asResponse: false,
      returnHeaders: true,
    });
    const session = await getFlaremoUserByAuthSessionToken(
      db,
      result.response.token,
    );
    if (!session) throw new Error("Better Auth session could not be resolved");
    const nativeTokens = await issueMemosNativeTokens({
      db,
      env: c.env,
      authUserId: session.authUserId,
      user: session.user,
      request: c.req.raw,
    });
    const response = await connectValue(
      c,
      {
        user: currentUserToDto(
          session.user,
          await getAuthUserCached(db, session.authUserId),
        ),
        accessToken: nativeTokens.accessToken,
        accessTokenExpiresAt: nativeTokens.accessTokenExpiresAt.toISOString(),
      },
      transport,
    );
    copyResponseHeaders(response.headers, result.headers);
    response.headers.append("set-cookie", nativeTokens.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (isBetterAuthCredentialError(error)) {
      return transport
        ? connectErrorForTransport(
            c,
            transport,
            "invalid_argument",
            "unmatched username and password",
            400,
          )
        : connectError(
            c,
            "invalid_argument",
            "unmatched username and password",
            400,
          );
    }
    return connectErrorFrom(c, error, transport);
  }
}

export async function connectAuthRefresh(
  c: ConnectContext,
  transport?: BinaryTransport,
) {
  try {
    if (c.req.raw.headers.get("cookie")) assertTrustedCookieMutation(c);
    const db = getFlareMoDb(c.env);
    const rotated = await rotateMemosRefreshToken({
      db,
      env: c.env,
      request: c.req.raw,
    });
    if (!rotated) {
      return connectErrorForTransport(
        c,
        transport,
        "unauthenticated",
        "Refresh token is invalid or expired",
        401,
      );
    }
    const response = await connectValue(
      c,
      {
        accessToken: rotated.accessToken,
        expiresAt: rotated.accessTokenExpiresAt.toISOString(),
      },
      transport,
    );
    response.headers.append("set-cookie", rotated.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return connectErrorFrom(c, error, transport);
  }
}

export async function connectAuthSignOut(
  c: ConnectContext,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  transport?: BinaryTransport,
) {
  try {
    if (c.req.raw.headers.get("cookie")) assertTrustedCookieMutation(c);
    await revokeMemosRefreshToken({
      db: context.db,
      env: c.env,
      headers: c.req.raw.headers,
      expectedAuthUserId: context.authUserId,
    });
    const response = await connectValue(c, {}, transport);
    const bearer = c.req.header("authorization");
    if (context.bearerSession && bearer) {
      await revokeAuthSessionByToken(context.db, parseBearerForSignOut(bearer));
    }
    if (c.req.raw.headers.get("cookie")) {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("authorization");
      const authResponse = await (
        await getFlareMoAuth(c.env)
      ).handler(
        new Request(new URL("/api/auth/sign-out", c.req.url), {
          method: "POST",
          headers,
        }),
      );
      copyResponseHeaders(response.headers, authResponse.headers);
    }
    response.headers.append("set-cookie", clearMemosRefreshCookie(c.req.raw));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return connectErrorFrom(c, error, transport);
  }
}

function copyResponseHeaders(target: Headers, source: Headers) {
  for (const [name, value] of source.entries()) {
    if (name === "set-cookie") target.append(name, value);
    // Better Auth returns a JSON representation for its sign-out/sign-in
    // handler. The Connect adapter has already selected the protobuf
    // representation, so copying representation headers would make a valid
    // binary response undecodable by generated clients (especially an empty
    // google.protobuf.Empty response).
    else if (name === "content-type" || name === "content-length") continue;
    else target.set(name, value);
  }
}
export async function connectAuthSignUp(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  try {
    assertTrustedCookieMutation(c);
    const body = record(value);
    const username = requiredString(body.username, "username");
    const password = requiredString(body.password, "password");
    if (password.length < 8) {
      throw new CompatValidationError("password must be at least 8 characters");
    }
    const displayName =
      optionalString(body.displayName) ??
      optionalString(body.nickname) ??
      username;

    const db = getFlareMoDb(c.env);
    const bootstrap = await getAuthBootstrapStatus(db);
    if (bootstrap.state !== "complete") {
      return connectErrorForTransport(
        c,
        transport,
        "permission_denied",
        "Registration is not available yet",
        403,
      );
    }
    if (!(await getUserRegistrationAllowed(db))) {
      return connectErrorForTransport(
        c,
        transport,
        "permission_denied",
        "User registration is disabled",
        403,
      );
    }
    // With a transactional-email provider configured, registration requires
    // verifying a real mailbox through the web app. This compat surface
    // cannot complete that flow, so refuse rather than minting unverified
    // accounts that bypass the deployment's anti-abuse gate.
    if ((await resolveEmailSendConfig(c.env, db)).provider !== "none") {
      throw new ForbiddenError(
        "Email verification is required. Please use the FlareMo web app to sign up.",
      );
    }

    await verifyCaptchaRequest(c.env, c.req.raw);
    const email = optionalString(body.email) ?? `${username}@flaremo.local`;
    const { authUserId, user, dto } = await createConnectUser(
      c,
      db,
      {
        username,
        password,
        displayName,
        email,
      },
      c.get("planLimits") ?? SELF_HOST_UNLIMITED,
    );
    const nativeTokens = await issueMemosNativeTokens({
      db,
      env: c.env,
      authUserId,
      user,
      request: c.req.raw,
    });
    const response = await connectValue(
      c,
      {
        user: dto,
        accessToken: nativeTokens.accessToken,
        accessTokenExpiresAt: nativeTokens.accessTokenExpiresAt.toISOString(),
      },
      transport,
    );
    response.headers.append("set-cookie", nativeTokens.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return connectErrorFrom(c, error, transport);
  }
}
function parseBearerForSignOut(value: string) {
  const token = splitBearerToken(value);
  if (token === null)
    throw new CompatValidationError("Invalid authorization header");
  return token;
}
