import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { createDb, taskActivity, tasks } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveProject,
  createProject,
  hardDeleteProject,
  listProjects,
} from "./projects";
import {
  createTask,
  hardDeleteTask,
  listTaskActivity,
  listTasks,
  reorderTasks,
  type TaskActor,
  updateTask,
} from "./tasks";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

const USER: TaskActor = { type: "user" };
const AGENT: TaskActor = { type: "agent", name: "codex" };

async function applyMigration(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  sql: string,
) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await database.prepare(statement).run();
  }
}

describe("projects and tasks domain services", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-projects-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    const migrationNames = [
      "0000_illegal_inhumans.sql",
      "0001_familiar_morph.sql",
      "0002_wooden_professor_monster.sql",
      "0003_equal_maximus.sql",
      "0004_complex_the_enforcers.sql",
      "0005_confused_masque.sql",
      "0007_flat_phil_sheldon.sql",
      "0008_legal_scarecrow.sql",
      "0009_neat_iron_fist.sql",
      "0010_deep_gateway.sql",
      "0011_daffy_ultron.sql",
      "0012_slow_nick_fury.sql",
      "0013_nosy_luke_cage.sql",
    ];
    for (const name of migrationNames) {
      const sql = await readFile(
        resolve(import.meta.dirname, `../../../migrations/${name}`),
        "utf8",
      );
      await applyMigration(database, sql);
    }
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates a project and reports task counts", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    expect(project.task_count_total).toBe(0);
    expect(project.task_count_open).toBe(0);

    await createTask(db, user, USER, {
      project_id: project.id,
      title: "写文档",
    });
    await createTask(db, user, AGENT, {
      project_id: project.id,
      title: "跑测试",
      status: "done",
    });

    const listed = await listProjects(db, user);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.task_count_total).toBe(2);
    expect(listed[0]?.task_count_open).toBe(1);
  });

  it("tracks status transitions through completed_at and the activity trail", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    const task = await createTask(db, user, USER, {
      project_id: project.id,
      title: "实现项目",
    });
    expect(task.completed_at).toBeNull();

    const done = await updateTask(db, user, AGENT, task.id, {
      status: "done",
    });
    expect(done.status).toBe("done");
    expect(done.completed_at).not.toBeNull();

    const reopened = await updateTask(db, user, USER, task.id, {
      status: "todo",
    });
    expect(reopened.completed_at).toBeNull();

    const activity = await listTaskActivity(db, user, task.id);
    const actions = activity.map((entry) => entry.action);
    expect(actions).toContain("created");
    expect(actions).toContain("status_changed");
    // Agent and user writes are both recorded and attributable.
    expect(activity.some((entry) => entry.actor_type === "agent")).toBe(true);
    expect(activity.some((entry) => entry.actor_type === "user")).toBe(true);
  });

  it("reorders tasks within a project", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    const a = await createTask(db, user, USER, {
      project_id: project.id,
      title: "A",
    });
    const b = await createTask(db, user, USER, {
      project_id: project.id,
      title: "B",
    });
    const c = await createTask(db, user, USER, {
      project_id: project.id,
      title: "C",
    });

    const ordered = await reorderTasks(db, user, USER, project.id, [
      c.id,
      a.id,
      b.id,
    ]);
    expect(ordered.map((task) => task.title)).toEqual(["C", "A", "B"]);
  });

  it("filters tasks by project and status", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    await createTask(db, user, USER, {
      project_id: project.id,
      title: "进行中",
      status: "in_progress",
    });
    await createTask(db, user, USER, {
      project_id: project.id,
      title: "待办",
    });

    const open = await listTasks(db, user, {
      projectId: project.id,
      status: "todo",
    });
    expect(open).toHaveLength(1);
    expect(open[0]?.title).toBe("待办");
  });

  it("archives and hard deletes a project, cascading tasks", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    await createTask(db, user, USER, {
      project_id: project.id,
      title: "任务",
    });

    const archived = await archiveProject(db, user, project.id, true);
    expect(archived.status).toBe("archived");

    await hardDeleteProject(db, user, project.id);
    expect(await listProjects(db, user)).toHaveLength(0);

    const rows = await db.select().from(tasks);
    expect(rows).toHaveLength(0);
  });

  it("hard deletes a single task and clears its activity", async () => {
    const project = await createProject(db, user, { name: "FlareMo" });
    const task = await createTask(db, user, USER, {
      project_id: project.id,
      title: "删除我",
    });
    await hardDeleteTask(db, user, task.id);

    expect(await listTasks(db, user, { projectId: project.id })).toHaveLength(
      0,
    );
    const activity = await db.select().from(taskActivity);
    expect(activity).toHaveLength(0);
  });
});
