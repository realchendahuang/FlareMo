import type {
  CreateProjectInput,
  ProjectDto,
  UpdateProjectInput,
} from "@flaremo/contracts";
import type { FlareMoDb, ProjectRow, UserRow } from "@flaremo/db";
import { projects, tasks } from "@flaremo/db";
import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";

// D1 caps bound parameters per statement at 100. Leave room for the cutoff
// predicate that is repeated on delete after the initial candidate read.
const HARD_DELETE_BATCH_SIZE = 96;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function projectToDto(
  row: ProjectRow,
  counts: { total: number; open: number },
): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    task_count_total: counts.total,
    task_count_open: counts.open,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

/**
 * Resolve one of the caller's projects. The default read excludes recycle-bin
 * rows (soft-deleted projects 404 to every live read, including writes that
 * would target them); the restore path opts back in with `includeDeleted`.
 */
export async function requireProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ProjectRow> {
  const filters = [eq(projects.id, id), eq(projects.userId, user.id)];
  if (!options.includeDeleted) filters.push(isNull(projects.deletedAt));
  const row = await db
    .select()
    .from(projects)
    .where(and(...filters))
    .get();
  if (!row) throw new NotFoundError(`Project not found: ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createProject(
  db: FlareMoDb,
  user: UserRow,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Project name cannot be empty.");

  const now = new Date().toISOString();
  const row = await db
    .insert(projects)
    .values({
      id: createResourceId("projects"),
      userId: user.id,
      name,
      description: input.description?.trim() || null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return projectToDto(row, { total: 0, open: 0 });
}

export async function getProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ProjectDto> {
  const row = await requireProject(db, user, id);
  return projectToDto(row, await countTasksByProject(db, user, id));
}

export async function listProjects(
  db: FlareMoDb,
  user: UserRow,
  input: {
    status?: ProjectRow["status"];
    query?: string;
    includeDeleted?: boolean;
  } = {},
): Promise<ProjectDto[]> {
  const filters = [eq(projects.userId, user.id)];
  if (!input.includeDeleted) filters.push(isNull(projects.deletedAt));
  if (input.status) filters.push(eq(projects.status, input.status));
  const query = input.query?.trim();
  if (query) {
    filters.push(
      sql`${projects.name} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
    );
  }

  const rows = await db
    .select()
    .from(projects)
    .where(and(...filters))
    .orderBy(asc(projects.createdAt), asc(projects.id));

  const counts = await countTasksByProjects(
    db,
    user,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    projectToDto(row, counts.get(row.id) ?? { total: 0, open: 0 }),
  );
}

export async function updateProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  const existing = await requireProject(db, user, id);
  const next = { ...existing };
  if (input.name !== undefined) {
    next.name = input.name.trim();
    if (!next.name) throw new ValidationError("Project name cannot be empty.");
  }
  if (input.description !== undefined) {
    next.description = input.description?.trim() || null;
  }

  const now = new Date().toISOString();
  await db
    .update(projects)
    .set({ name: next.name, description: next.description, updatedAt: now })
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
  return getProject(db, user, id);
}

export async function archiveProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  archived: boolean,
): Promise<ProjectDto> {
  await requireProject(db, user, id);
  await db
    .update(projects)
    .set({
      status: archived ? "archived" : "active",
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
  return getProject(db, user, id);
}

// ---------------------------------------------------------------------------
// Recycle bin (soft delete)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a project together with every still-live task under it. Nothing
 * is physically removed here: rows keep carrying a `deleted_at` stamp, the
 * activity trail stays readable while a task sits in the bin, and the daily
 * trash purge is what eventually hard-deletes past the TTL.
 */
export async function deleteProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<{ ok: true }> {
  await requireProject(db, user, id);
  const now = new Date().toISOString();
  await db.batch([
    db
      .update(projects)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(projects.id, id),
          eq(projects.userId, user.id),
          isNull(projects.deletedAt),
        ),
      ),
    // A task the user deleted earlier keeps its own (older) stamp so restoring
    // the project does not resurrect it.
    db
      .update(tasks)
      .set({ deletedAt: now })
      .where(
        and(
          eq(tasks.userId, user.id),
          eq(tasks.projectId, id),
          isNull(tasks.deletedAt),
        ),
      ),
  ]);
  return { ok: true };
}

/**
 * Restore a soft-deleted project and the tasks that were binned together with
 * it (same `deleted_at` stamp). Tasks the user deleted individually before the
 * project deletion keep their own stamp and stay in the bin.
 */
export async function restoreProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ProjectDto> {
  const existing = await requireProject(db, user, id, {
    includeDeleted: true,
  });
  if (existing.deletedAt) {
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(projects)
        .set({ deletedAt: null, updatedAt: now })
        .where(and(eq(projects.id, id), eq(projects.userId, user.id))),
      db
        .update(tasks)
        .set({ deletedAt: null })
        .where(
          and(
            eq(tasks.userId, user.id),
            eq(tasks.projectId, id),
            eq(tasks.deletedAt, existing.deletedAt),
          ),
        ),
    ]);
  }
  return getProject(db, user, id);
}

// ---------------------------------------------------------------------------
// Task counts
// ---------------------------------------------------------------------------

async function countTasksByProject(
  db: FlareMoDb,
  user: UserRow,
  projectId: string,
): Promise<{ total: number; open: number }> {
  const counts = await countTasksByProjects(db, user, [projectId]);
  return counts.get(projectId) ?? { total: 0, open: 0 };
}

/**
 * Grouped task counts for a batch of projects, excluding soft-deleted tasks.
 * `open` means not done yet (todo or in_progress).
 */
export async function countTasksByProjects(
  db: FlareMoDb,
  user: UserRow,
  projectIds: string[],
): Promise<Map<string, { total: number; open: number }>> {
  const result = new Map<string, { total: number; open: number }>();
  if (projectIds.length === 0) return result;

  // One id = one bound parameter, plus the user predicate, so an account with
  // more than ~99 projects would blow D1's per-statement cap here.
  for (const idChunk of chunkForD1(projectIds, d1IdsPerStatement(2))) {
    const rows = await db
      .select({
        projectId: tasks.projectId,
        total: count(),
        open: sql<number>`SUM(CASE WHEN ${tasks.status} != 'done' THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          inArray(tasks.projectId, idChunk),
        ),
      )
      .groupBy(tasks.projectId);

    for (const row of rows) {
      if (row.projectId) {
        result.set(row.projectId, { total: row.total, open: row.open ?? 0 });
      }
    }
  }
  return result;
}

/**
 * Hard-delete projects whose recycle-bin TTL expired. `deleted_at < cutoff`
 * never matches NULL, so live rows are safe; the FK cascade removes their
 * tasks and the tasks' activity rows in the same statement. Standalone
 * soft-deleted tasks are swept by their own TTL path (see tasks.ts).
 */
export async function hardDeleteExpiredProjects(
  db: FlareMoDb,
  cutoff: string,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const expired = await db
      .select({ id: projects.id })
      .from(projects)
      .where(lt(projects.deletedAt, cutoff))
      .limit(HARD_DELETE_BATCH_SIZE)
      .all();
    if (expired.length === 0) break;

    const removed = await db
      .delete(projects)
      .where(
        and(
          lt(projects.deletedAt, cutoff),
          inArray(
            projects.id,
            expired.map((row) => row.id),
          ),
        ),
      )
      .returning({ id: projects.id });
    // D1 meta.changes includes cascaded task/activity rows; count only the
    // root projects returned by this delete.
    deleted += removed.length;
  }
  return deleted;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
