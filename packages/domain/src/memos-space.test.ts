import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemo,
  getMemoById,
  getMemoStats,
  listMemosForViewer,
  updateMemo,
} from "./memos";
import { listTagHierarchy } from "./tags";
import type { TeamViewer } from "./team-permissions";
import { createTeamMember, ensureTeamOwner } from "./test-support";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: TeamViewer;
let member: TeamViewer;

beforeEach(async () => {
  mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "flaremo-space-test" },
  });
  const database = await mf.getD1Database("DB");
  db = createDb(database);
  await applyFlaremoMigrations(database);
  owner = await ensureTeamOwner(db);
  member = await createTeamMember(db, "Alice");
});

afterEach(async () => {
  await mf.dispose();
});

type Space = "all" | "personal" | "team";

async function idsFor(
  viewer: TeamViewer,
  space?: Space,
  state?: "normal" | "archived" | "trashed",
): Promise<Set<string>> {
  const result = await listMemosForViewer(db, viewer, {
    page_size: 100,
    order_by: "created_at asc",
    include_deleted: false,
    ...(space ? { space } : {}),
    ...(state ? { state } : {}),
  });
  return new Set(result.memos.map((memo) => memo.id));
}

describe("listMemosForViewer space scoping", () => {
  let ownPrivate: string;
  let ownTeamNormal: string;
  let ownTeamArchived: string;
  let otherTeam: string;
  let otherPrivate: string;

  beforeEach(async () => {
    ownPrivate = (
      await createMemo(db, member, {
        content: "personal note",
        visibility: "private",
        source: "web",
      })
    ).id;
    const ownTeam = await createMemo(db, member, {
      content: "own team note",
      visibility: "protected",
      source: "web",
    });
    ownTeamNormal = ownTeam.id;
    const ownArchived = await createMemo(db, member, {
      content: "own archived team note",
      visibility: "protected",
      source: "web",
    });
    await updateMemo(db, member, ownArchived.id, { status: "archived" });
    ownTeamArchived = ownArchived.id;
    otherTeam = (
      await createMemo(db, owner, {
        content: "owner team note",
        visibility: "protected",
        source: "web",
      })
    ).id;
    otherPrivate = (
      await createMemo(db, owner, {
        content: "owner private note",
        visibility: "private",
        source: "web",
      })
    ).id;
  });

  it("personal space contains only the viewer's own unshared notes", async () => {
    const ids = await idsFor(member, "personal");
    expect(ids.has(ownPrivate)).toBe(true);
    expect(ids.has(ownTeamNormal)).toBe(false);
    expect(ids.has(ownTeamArchived)).toBe(false);
    expect(ids.has(otherTeam)).toBe(false);
    expect(ids.has(otherPrivate)).toBe(false);
  });

  it("team space contains shared notes from both authors, not personal ones", async () => {
    const ids = await idsFor(member, "team");
    expect(ids.has(ownTeamNormal)).toBe(true);
    expect(ids.has(otherTeam)).toBe(true);
    expect(ids.has(ownPrivate)).toBe(false);
    expect(ids.has(otherPrivate)).toBe(false);
  });

  it("own published notes live in the team space, not the personal one", async () => {
    const team = await idsFor(member, "team");
    expect(team.has(ownTeamNormal)).toBe(true);
    expect(team.has(ownPrivate)).toBe(false);
    const personal = await idsFor(member, "personal");
    expect(personal.has(ownPrivate)).toBe(true);
    expect(personal.has(ownTeamNormal)).toBe(false);
  });

  it("all space matches the unscoped read boundary", async () => {
    const explicitAll = await idsFor(member, "all");
    const implicitAll = await idsFor(member);
    expect(explicitAll).toEqual(implicitAll);
    expect(explicitAll.has(ownPrivate)).toBe(true);
    expect(explicitAll.has(otherTeam)).toBe(true);
    expect(explicitAll.has(otherPrivate)).toBe(false);
  });

  it("composes with the state filter: archived team notes stay member-invisible", async () => {
    const archivedTeam = await idsFor(member, "team", "archived");
    // The author's own archived row stays readable (memoReadScope author
    // clause), but other members' archived team notes stay invisible.
    expect(archivedTeam.has(ownTeamArchived)).toBe(true);
    expect(archivedTeam.has(otherTeam)).toBe(false);
  });

  it("gives admins the team archive in team space", async () => {
    const archivedTeam = await idsFor(owner, "team", "archived");
    expect(archivedTeam.has(ownTeamArchived)).toBe(true);
  });

  it("returns an empty team space for a viewer without a team", async () => {
    // Read-only viewer: the harness helpers only provision team members, and
    // listing never writes, so a membership-less viewer is safe to hand-roll.
    const outsider: TeamViewer = {
      ...member,
      id: "users/outsider",
      teamRole: null,
      teamOrganizationId: null,
    };
    expect((await idsFor(outsider, "team")).size).toBe(0);
    expect((await idsFor(outsider, "personal")).size).toBe(0);
    expect((await idsFor(outsider, "all")).size).toBe(0);
  });
});

describe("space-scoped stats and tags", () => {
  let ownPrivate: string;
  let ownTeam: string;
  let otherTeam: string;

  beforeEach(async () => {
    ownPrivate = (
      await createMemo(db, member, {
        content: "personal #space-tags",
        visibility: "private",
        source: "web",
      })
    ).id;
    ownTeam = (
      await createMemo(db, member, {
        content: "own team #space-tags",
        visibility: "protected",
        source: "web",
      })
    ).id;
    otherTeam = (
      await createMemo(db, owner, {
        content: "owner team #space-tags",
        visibility: "protected",
        source: "web",
      })
    ).id;
  });

  it("partitions counts per space under the read boundary", async () => {
    const stats = await getMemoStats(
      db,
      member,
      { time_zone: "UTC" },
      {
        space: "all",
      },
    );
    expect(stats.counts.normal).toBe(3);
    expect(stats.counts.spaces?.personal).toBe(1);
    expect(stats.counts.spaces?.team).toBe(2);
  });

  it("scopes stats to the requested space", async () => {
    const personal = await getMemoStats(
      db,
      member,
      { time_zone: "UTC" },
      {
        space: "personal",
      },
    );
    expect(personal.counts.normal).toBe(1);
    const team = await getMemoStats(
      db,
      member,
      { time_zone: "UTC" },
      {
        space: "team",
      },
    );
    expect(team.counts.normal).toBe(2);
  });

  it("keeps legacy stats own-only without a space", async () => {
    const legacy = await getMemoStats(db, member, { time_zone: "UTC" });
    expect(legacy.counts.normal).toBe(2);
    expect(legacy.counts.spaces).toBeUndefined();
  });

  it("scopes the tag tree to the requested space", async () => {
    const tagOf = async (space: "all" | "personal" | "team" | undefined) => {
      const tree = await listTagHierarchy(db, member, space ? { space } : {});
      return tree.map((node) => ({ name: node.name, count: node.count }));
    };
    expect(await tagOf("personal")).toEqual([{ name: "space-tags", count: 1 }]);
    expect(tagOf("team")).resolves.toEqual([{ name: "space-tags", count: 2 }]);
    // Legacy call (no space) keeps the own-corpus semantics.
    expect(tagOf(undefined)).resolves.toEqual([
      { name: "space-tags", count: 2 },
    ]);
  });
});

describe("updateMemo tag re-extraction", () => {
  it("re-derives tags from the new content when the patch carries no payload", async () => {
    const memo = await createMemo(db, member, {
      content: "first draft",
      visibility: "private",
      source: "web",
    });
    // No tags at creation time: the stored payload has tags: [].
    expect(memo.payload.tags).toEqual([]);

    // The web editor PATCHes only content+visibility; the added #随笔 must
    // still be extracted (issue #139: tags used to freeze at creation time).
    await updateMemo(db, member, memo.id, {
      content: "first draft #随笔",
      visibility: "private",
    });
    const edited = await getMemoById(db, member, memo.id);
    expect(edited.payload.tags).toEqual(["随笔"]);
    const tree = await listTagHierarchy(db, member, {});
    expect(tree.map((node) => ({ name: node.name, count: node.count }))).toEqual(
      [{ name: "随笔", count: 1 }],
    );

    // Removing the token in a later edit drops the tag again.
    await updateMemo(db, member, memo.id, {
      content: "second draft",
      visibility: "private",
    });
    const reEdited = await getMemoById(db, member, memo.id);
    expect(reEdited.payload.tags).toEqual([]);
    expect(await listTagHierarchy(db, member, {})).toEqual([]);
  });

  it("honors payload.tags when the patch carries an explicit payload", async () => {
    const memo = await createMemo(db, member, {
      content: "first draft",
      visibility: "private",
      source: "web",
    });
    // Import overwrite / revision restore semantics: the caller manages the
    // tag list itself, so a content edit plus explicit payload keeps tags the
    // content does not spell out.
    await updateMemo(db, member, memo.id, {
      content: "first draft edited",
      visibility: "private",
      payload: { tags: ["imported-tag"] },
    });
    const edited = await getMemoById(db, member, memo.id);
    expect(edited.payload.tags).toEqual(["imported-tag"]);
    const tree = await listTagHierarchy(db, member, {});
    expect(tree.map((node) => node.name)).toEqual(["imported-tag"]);
  });
});
