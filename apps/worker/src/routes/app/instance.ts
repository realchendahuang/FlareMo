import { FLAREMO_API_VERSION } from "@flaremo/contracts/constants";
import type { Hono } from "hono";
import type { HonoBindings } from "../../context";

/**
 * Capability discovery for the native clients (docs/native-clients.md §4.6).
 *
 * Anonymous and cacheable on purpose: a client must be able to decide how to
 * sync before it has credentials (the login screen can show "this instance
 * needs an upgrade"), and the payload only changes on deploy.
 *
 * `capabilities` is an object of `name → version` (not a string array) so a
 * future incompatible revision of one feature can advertise `sync_changes: 2`
 * without inventing a second name. A capability is only advertised when the
 * instance actually serves it; a client that finds it missing (or 0) degrades
 * to the documented fallback instead of calling a route that 404s:
 *
 * - `sync_changes` / `sync_hydrate` — §4.4 endpoints below `/api/app/sync`.
 * - `soft_delete_tombstone` — `deleted_at` rows are synced as `op: "delete"`
 *   instead of being dropped, so a client can mirror the recycle bin.
 * - `optimistic_lock` — currently 0: the `version` columns exist (0048) but
 *   `PATCH /api/app/memos/:id` does not yet enforce `expected_version`, so
 *   advertising 1 would make a client trust a 409 that never arrives.
 * - `native_push` — provider list this deployment can deliver through. Empty
 *   until the APNs/FCM registration + delivery path lands (§4.10); the device
 *   table itself is already in 0048.
 * - `direct_upload` / `pat_grant` — D9/D11, not implemented yet; clients fall
 *   back to the multipart attachment route and the device-code grant.
 */
export function registerInstanceRoutes(app: Hono<HonoBindings>) {
  app.get("/instance", (c) =>
    c.json(
      {
        version: FLAREMO_API_VERSION,
        api_versions: ["app-v1"],
        capabilities: {
          sync_changes: 1,
          sync_hydrate: 1,
          soft_delete_tombstone: 1,
          optimistic_lock: 0,
          native_push: [],
          direct_upload: 0,
          pat_grant: 0,
        },
      },
      200,
      { "cache-control": "public, max-age=300" },
    ),
  );
}
