import type { Context } from "hono";
import type { HonoBindings } from "./context";

/**
 * Minimal shape of Cloudflare's rate-limiting binding. Deployments opt in by
 * binding e.g. `RATE_LIMITER` in wrangler config; unbound deployments keep
 * the exact previous behavior.
 */
export type RateLimiterBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

/**
 * Best-effort client IP. Cloudflare writes `cf-connecting-ip` before the
 * Worker runs; the fallbacks only matter for local development.
 */
export function clientIpFromRequest(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Bucketed per-IP check against the deployment's rate-limiting binding.
 * Absent binding → allowed. Binding errors fail open: this is deployment
 * hardening for credential endpoints, not a correctness gate, and taking the
 * whole auth surface down because a limiter hiccupped is the worse failure.
 */
export async function checkRateLimit(
  limiter: RateLimiterBinding | undefined,
  bucket: string,
  request: Request,
): Promise<boolean> {
  if (!limiter) return false;
  try {
    const result = await limiter.limit({
      key: `${bucket}:${clientIpFromRequest(request)}`,
    });
    return !result.success;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Rate limiter binding failed; failing open",
        error: String(error),
      }),
    );
    return false;
  }
}

/**
 * Apply one rate-limit bucket to the current request; returns a 429 response
 * when the caller is throttled, or null to continue.
 */
export async function rateLimitGuard(
  c: Context<HonoBindings>,
  bucket: string,
): Promise<Response | null> {
  const limited = await checkRateLimit(c.env.RATE_LIMITER, bucket, c.req.raw);
  if (!limited) return null;
  return c.json(
    { error: { message: "Too many requests. Please try again later." } },
    429,
  );
}

/**
 * Better Auth credential endpoints worth edge-throttling, by path suffix.
 * GETs (session reads) are excluded on purpose.
 */
const RATE_LIMITED_AUTH_PATHS = [
  "/sign-in/",
  "/sign-up/",
  "/forget-password",
  "/reset-password",
];

export function betterAuthRateLimitBucket(pathname: string): string | null {
  if (!RATE_LIMITED_AUTH_PATHS.some((suffix) => pathname.includes(suffix))) {
    return null;
  }
  return "auth";
}
