import { apiRequest } from "./client";
import type { LatestRelease } from "./types";

/**
 * Latest stable release through the Worker proxy. GitHub is not reachable from
 * some networks and rate-limits unauthenticated clients per IP, so the Worker
 * fetches and edge-caches it instead of every browser calling api.github.com.
 */
export async function getLatestRelease(
  repository: string | null | undefined = null,
): Promise<LatestRelease> {
  const query = repository
    ? `?repository=${encodeURIComponent(repository)}`
    : "";
  return apiRequest<LatestRelease>(`/api/app/releases/latest${query}`);
}
