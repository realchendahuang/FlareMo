export function errorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * Matches the Worker's exact-Origin 403s (`assertTrustedCookieMutation`, the
 * bearer-origin check, and Better Auth's own trusted-origin guard). Reads
 * still succeed from such an address, so these must not be reported as an
 * expired session.
 */
export function isUntrustedOriginError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? error.status : undefined;
  const message = "message" in error ? error.message : undefined;
  return (
    status === 403 && typeof message === "string" && /origin/i.test(message)
  );
}
