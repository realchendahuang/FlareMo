import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser authentication is deliberately same-origin. Sessions live only in
 * Better Auth's HttpOnly cookie; neither a session token nor a password is
 * persisted in browser storage by this client.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "same-origin",
  },
  plugins: [usernameClient()],
});
