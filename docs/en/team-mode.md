# FlareMo Team Mode

## Positioning

Team mode is a core capability of the open-source FlareMo project — not a separate edition, not a paid tier, and not a deployment-time mode switch.

- With a single member, FlareMo keeps the existing personal experience.
- Once a team administrator adds other members, they can share team-visible notes and attachments.
- Every self-hosting user gets the full team capability.
- Each deployment has exactly one team; no organizations, departments, groups, multi-team, multi-tenant, approval flows, SSO, or SCIM.

## Model

The team is a first-class entity (the Better Auth organization plugin's `auth_organizations` table); membership and roles live in `auth_members`, the single source of truth for roles:

- The domain `users` table carries no role column;
- Notes attach to the team via `memos.team_id`: `NULL` means a personal note, non-null a team note;
- Note visibility `private` is equivalent to an empty `team_id`; team notes only have `protected` (team members read) and `public` (the whole web reads).

Authorization is provided uniformly by the domain layer's `team-permissions.ts` (read / govern / edit predicates plus one shared SQL row-level filter). Web, the Memos-compatible API, MCP, attachments, search, semantic search, and SSE must not maintain independent permission rules. Every request assembles a "user + team role" viewer once at credential resolution; a viewer without membership is always treated as having no team access (fail-closed).

## Goals

A minimal, complete team collaboration loop:

1. Team administrators add and manage members.
2. Members sign in with their own accounts.
3. Members can create private, team-visible, or world-public notes.
4. Active members can read team-visible notes and their attachments.
5. Team administrators can manage members and govern team content, but cannot read members' private content or rewrite anyone's notes.
6. Removed members lose access; their private and personal data is deleted, team and public content is claimed by the owner and stays available.

## Non-goals

The first version does not implement:

- Organizations, departments, groups, or custom roles;
- Multi-team or cross-team collaboration;
- Per-resource member lists or complex ACLs;
- Open registration, email verification, or email invitation flows for team mode;
- SSO, SCIM, approval flows, or heavy auditing;
- Team projects or team tasks;
- Freeze periods or personal-data export after removal.

## Members and roles

Roles are defined on the team (organization) membership:

- `owner`: the team owner, usually the bootstrap account. May edit/re-publish/hard-delete other members' team notes and set the administrator role. Deployment-level settings (open registration, branding, vector rebuilds) belong to the instance owner (the bootstrap account) and are independent of team roles;
- `admin`: team administrator. Reads and governs (archive, trash, restore) team and public content, adds and removes members, resets member passwords;
- `member`: an ordinary team member who reads team and public content;
- `reader`: a read-only seat with an optional expiry (`expires_at`) that automatically loses team access when it lapses — see "Reader Seats" below.

Member states:

- `active`: may sign in and use everything normally;
- `removed`: cannot sign in, does not appear in the normal member list, but the row is kept so historical author names can be shown.

Constraints:

- The team must keep at least one active administrator;
- The last active administrator cannot be removed or demoted;
- Role changes belong to the team owner only — administrators never manage each other (no cross role changes, password resets, or removals);
- Removed members cannot continue through cookie sessions, PATs, MCP, scripts, or the compatible API;
- The email is only the unique login identifier; no emails are sent or verified.

## Reader Seats (reader)

A reader seat is a **time-boxed read-only role**: the fourth `auth_members.role` value `reader`, paired with a nullable `expires_at`. It answers the generic need "give someone a read-only seat with a term" — guest readers, course cohorts, client delivery, beta windows. How seats are distributed (manually, redemption codes, a payment system) is outside FlareMo's boundary; the core ships the seat and one provisioning endpoint.

### Semantics

- Readers browse the team space (team-visible and world-public notes) but **can never publish into it** — creation, republishing, and PAT/API writes are all denied at `resolveMemoTeamId`;
- Readers' own personal notes are untouched (author permissions unchanged): a reader is a complete FlareMo user who can keep personal notes, tasks, and attachments in their personal space;
- **Access lapses automatically at expiry**: `getViewerTeamMembership` folds an expired reader out at credential resolution (fail-closed) — no cron, no sweep; access returns immediately after renewal;
- Expiry never deletes the account or personal data; /me returns `team_expired: true` and the UI shows a renewal notice instead of silently hiding the space;
- Team cards show no edit/delete menu for readers (author-only predicates), and stats, tags, full-text and semantic search keep working read-only under the space scoping rules.

### What a reader sees

- The sidebar and space switcher show the team space entry exactly as for members while the seat is valid;
- The team space shows a read-only notice ("this space is read-only — you are a reader and can browse but not publish") and no composer;
- The personal space works normally, but the send-target selector is hidden (readers can only write to themselves);
- Settings → Account profile shows "Reader valid until <date>" (/me's `reader_expires_at`);
- After expiry: the team entry disappears and the timeline shows a renewal notice (`team_expired`); the account and personal notes are fully functional.

### Management (UI)

Account page → Team:

- **Make reader / renew**: menu presets of 30 or 365 days; renewal extends from `max(now, current expiry)`, so topping up an active seat never discards days already paid for;
- **Revoke reader**: deletes the membership row and the team space disappears (if the user was previously a full member, their published team notes remain, handled like any member departure);
- The member list shows a "Reader" badge with "Reader until <date>"; lapsed seats keep rendering with their past date for reconciliation;
- Owners and administrators can never be demoted into readers (403);
- Upgrade path: reader → member via the existing role-switch entry (owner only); the old expiry is cleared automatically.

### Machine provisioning

External systems (scripts, payment webhooks, bots) call the admin endpoints with a PAT. A PAT has exactly the same permission boundary as a browser session: **the token owner's own role decides what it can do** — the instance owner's PAT can do everything the owner can; an ordinary member's PAT gets 403 on the admin surface.

Create a PAT on the account page (`memos_pat_` prefix), then integrate against this single endpoint:

```bash
# Provision (unknown email → create account + one-time activation link;
# known email → grant/renew the seat)
curl -X PUT https://<your-instance>/api/app/admin/team/reader \
  -H "Authorization: Bearer memos_pat_xxx" \
  -H "Content-Type: application/json" \
  -d '{"email": "reader@example.com", "name": "Reader", "expires_at": "2026-12-31T00:00:00.000Z"}'
```

Response example (newly created, HTTP 201):

```json
{
  "id": "users/…",
  "email": "reader@example.com",
  "name": "Reader",
  "username": "reader",
  "role": "reader",
  "reader_expires_at": "2026-12-31T00:00:00.000Z",
  "status": "active",
  "created": true,
  "activation_path": "/reset?token=…",
  "activation_expires_in_seconds": 3600
}
```

Contract:

- `expires_at` is an absolute ISO-8601 timestamp; pass `null` for a seat without an expiry. Renewal arithmetic (extending from the current expiry) belongs to the caller — the endpoint stores absolute dates only;
- **Idempotent**: repeated calls with the same email are deterministic — the account is created once, and each call sets the seat to the requested expiry (HTTP 200, `created: false`);
- A newly created account returns `created: true` and `activation_path` (a one-time activation link, valid 1 hour); hand it to the reader for first sign-in;
- A removed account returns 409; owner/admin targets return 403 (never demoted);
- `name` is optional and defaults to the email prefix.

Renewal, revocation, and listing:

```bash
# Renew: send the new absolute expiry (extend from the current one as you wish)
# Revoke a seat (by user id):
curl -X DELETE https://<your-instance>/api/app/admin/users/<user-id>/reader \
  -H "Authorization: Bearer memos_pat_xxx"
# List members and seats (role / reader_expires_at included):
curl https://<your-instance>/api/app/admin/users \
  -H "Authorization: Bearer memos_pat_xxx"
```

The per-user endpoints (`PUT/DELETE /api/app/admin/users/:id/reader`, `PATCH /api/app/admin/users/:id/role`) remain available under browser sessions.

### FAQ

- **Do a reader's notes survive expiry?** Yes. The personal space and account are untouched; only team access fails. Revocation works the same way.
- **Can a reader become a full member?** Yes — the owner switches the role back to member (or administrator) on the members page; the seat expiry is cleared on promotion.
- **Can an owner/administrator be granted a seat?** No: the provisioning endpoint returns 403 for owner/admin targets. Demotions go through the owner's role-management entry instead.
- **Is there a seat cap?** Not in v1; the member quota (`assertMemberQuota`) still applies to newly created accounts.
- **Why no cron for expiry?** Expiry is decided at the single credential-resolution point (fail-closed): access dies at the instant of expiry, and no missed-job window can ever expose expired seats.

## Team Management

The "Team" section in the account page provides:

- View active members;
- Add members (administrators may do this);
- Set or unset team administrators (team owner only);
- Remove members (administrators remove ordinary members; the team owner removes administrators);
- Generate one-time password-reset links (administrators reset ordinary members; the team owner resets administrators).

Adding a member takes a name and email; the member joins the deployment's default team automatically. The team management UI offers no open-registration entry — new members are added by team administrators; the legacy registration switch from the compatible API is kept for existing deployments and stays off by default.

## Note Visibility

The storage keeps the compatible values; the product UI displays:

- `private`: only the author (`team_id` empty — a personal note);
- `protected`: team-visible (team members read);
- `public`: world-readable.

Permission matrix (someone else's note):

| Capability | Member | Team admin | Team owner | Reader |
| --- | --- | --- | --- | --- |
| Read team/public notes | ✅ (normal only) | ✅ (incl. archive/trash) | ✅ (incl. archive/trash) | ✅ (normal only) |
| Publish into the team | ✅ | ✅ | ✅ | ❌ |
| Govern: archive, trash, restore | ❌ | ✅ | ✅ | ❌ |
| Edit content / change visibility / hard delete | ❌ | ❌ | ✅ | ❌ |
| Read personal notes | ❌ | ❌ | ❌ | ❌ |

Authors always hold every capability over their own notes. The frontend renders actions from the server-provided `can_manage` (edit / visibility / share / hard delete) and `can_govern` (archive / trash / restore) flags — never derived client-side. Switching to world-public requires an explicit "anyone can access" confirmation.

## Attachments

- Attachments bound to a note always inherit the note's permissions;
- Unbound attachments are visible only to their uploader;
- No attachment listing, detail, blob, compatible file path, or share path may bypass note permissions.

## Search, Semantic Search, and Events

- Personal content is searchable only by its author;
- Team content is searchable by every active member;
- Public content is readable by signed-out visitors;
- Vectorize only returns candidates; the final result set must be filtered back in D1 against the current membership and note states;
- SSE must not leak personal notes' names, authors, or event types to other members or administrators.

## Removing a Member

When a team administrator removes a member:

1. Mark the member `removed` and cut off access immediately;
2. Revoke every session, PAT, and application credential, and delete the membership row;
3. Delete all of the member's personal notes and attachments;
4. Delete the corresponding R2 objects and Vectorize derived indexes;
5. Delete the member's personal projects and tasks;
6. The member's team-visible and world-public notes are claimed by the owner account (content and visibility unchanged, historical author names preserved);
7. Keep the historical author record;
8. Revoke share links the member created.

Removal must be safely retryable: repeating it must never delete content that should be retained.

## Legacy Data Migration

- The migration creates the default team (slug `flaremo`) and writes memberships for every active member according to the historical roles;
- Historical `owner` → team owner, historical `admin` → team admin, the rest → member;
- Historical `protected` notes become team notes (attached to the default team), `public` notes stay public attached to the default team, and `private` notes become personal notes;
- The `users.role` column is dropped after the migration; roles henceforth read only from the membership table.

## Acceptance

Verify with at least the owner, an admin, member A, member B, and a signed-out visitor:

- Admins can add members and a second administrator;
- The last active administrator cannot be removed or demoted;
- Administrators cannot change another administrator's role or password, nor remove one;
- Without the compatibility registration switch being explicitly turned on, public registration is rejected;
- Member B, the admin, and the owner cannot read member A's personal notes, attachments, search results, or SSE events;
- Member B can read member A's team notes and attachments but cannot edit or archive them;
- Admins can archive/restore/trash member A's team notes but cannot edit content or change visibility;
- The team owner can edit member A's team note content, change visibility, and hard-delete;
- Signed-out visitors can only read world-public notes and attachments;
- Web, the Memos-compatible API, MCP, attachments, full-text search, semantic search, and SSE all use the same permission matrix;
- After removal, old cookies, PATs, and MCP requests all fail;
- After removal, personal data is cleaned while team and public content, once claimed by the owner, remains accessible;
- Readers can read team and public notes, but every publishing path (web, PAT, compatible API) is rejected, and their personal notes are unaffected;
- Once a reader seat expires, the team space disappears on the next request (/me returns `team_expired: true`) with no cron involved; renewal restores it immediately;
- Reader seats can never be granted onto the owner or an administrator, and the provisioning endpoint cannot resurrect removed accounts;
- An external system holding the owner's PAT can provision and renew seats idempotently; an ordinary member's PAT cannot reach the admin surface.
