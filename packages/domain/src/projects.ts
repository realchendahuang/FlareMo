import type {
  CreateProjectInput,
  ProjectDto,
  UpdateProjectInput,
} from "@flaremo/contracts";
import type { FlareMoDb, ProjectRow, UserRow } from "@flaremo/db";
import { projects, tasks } from "@flaremo/db";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";

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
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

export async function requireProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<ProjectRow> {
  const row = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
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
  input: { status?: ProjectRow["status"] } = {},
): Promise<ProjectDto[]> {
  const filters = [eq(projects.userId, user.id)];
  if (input.status) filters.push(eq(projects.status, input.status));

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

export async function hardDeleteProject(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<{ ok: true }> {
  await requireProject(db, user, id);
  // Tasks cascade on delete via the FK; the activity trail for those tasks is
  // also cascade-deleted, matching the single-user "hard delete" semantics.
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
  return { ok: true };
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

  const rows = await db
    .select({
      projectId: tasks.projectId,
      total: count(),
      open: sql<number>`SUM(CASE WHEN ${tasks.status} != 'done' THEN 1 ELSE 0 END)`.mapWith(
        Number,
      ),
    })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), inArray(tasks.projectId, projectIds)))
    .groupBy(tasks.projectId);

  for (const row of rows) {
    result.set(row.projectId, { total: row.total, open: row.open ?? 0 });
  }
  return result;
}
