import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, createMemo, bootstrapAndSignIn } = createAppTestHarness(
  () => ({
    env,
    sessionCookie,
  }),
);

describe("FlareMo review and related memos API", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-test",
      attachmentsName: "flaremo-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("serves daily review and random walk endpoints", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const monthDay = today.slice(5);
    const dayAfter = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const quietDay = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const setCreatedAt = (name: string, createdAt: string) =>
      env.DB.prepare("UPDATE memos SET created_at = ? WHERE id = ?")
        .bind(createdAt, name)
        .run();

    // Daily review keeps past memos sharing today's month-day, ascending.
    const pastOne = await createMemo("one year ago today #history");
    const pastTwo = await createMemo("two years ago today");
    const otherDayMemo = await createMemo("written on another day");
    const todayMemo = await createMemo("written today");
    const archivedPast = await createMemo("archived past note");
    await setCreatedAt(pastOne.name, `2024-${monthDay}T10:00:00.000Z`);
    await setCreatedAt(pastTwo.name, `2022-${monthDay}T09:00:00.000Z`);
    await setCreatedAt(
      otherDayMemo.name,
      `2023-${dayAfter.slice(5)}T10:00:00.000Z`,
    );
    await setCreatedAt(archivedPast.name, `2021-${monthDay}T10:00:00.000Z`);
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${archivedPast.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }),
    );

    const daily = await json(
      await fetchApp(`http://flaremo.test/api/app/review/daily?date=${today}`),
    );
    expect(daily.memos.map((memo: { name: string }) => memo.name)).toEqual([
      pastTwo.name,
      pastOne.name,
    ]);
    expect(daily.memos[0].attachments).toEqual([]);

    const emptyDaily = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/daily?date=${quietDay}`,
      ),
    );
    expect(emptyDaily.memos).toEqual([]);
    expect(
      await fetchApp("http://flaremo.test/api/app/review/daily?date=08-11"),
    ).toMatchObject({ status: 400 });
    expect(
      await fetchApp(
        "http://flaremo.test/api/app/review/daily?date=2026-13-99",
      ),
    ).toMatchObject({ status: 400 });

    // tzOffset decides which local date a memo belongs to: 22:15 UTC on the
    // day before quietDay is already quietDay morning in UTC+8.
    const lateNight = await createMemo("written late at night locally");
    await setCreatedAt(
      lateNight.name,
      `2023-${dayAfter.slice(5)}T22:15:00.000Z`,
    );

    const shiftedDaily = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/daily?date=${quietDay}&tzOffset=480`,
      ),
    );
    expect(
      shiftedDaily.memos.map((memo: { name: string }) => memo.name),
    ).toEqual([lateNight.name]);

    const unshiftedDaily = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/daily?date=${quietDay}&tzOffset=-480`,
      ),
    );
    expect(unshiftedDaily.memos).toEqual([]);

    // "Exclude today" compares the shifted local date too: a memo whose
    // local creation date equals the review date stays excluded.
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tonight = await createMemo("tonight memo");
    await setCreatedAt(tonight.name, `${today}T22:15:00.000Z`);
    const tomorrowDaily = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/daily?date=${tomorrow}&tzOffset=480`,
      ),
    );
    expect(tomorrowDaily.memos).toEqual([]);

    const normalNames = [
      pastOne,
      pastTwo,
      otherDayMemo,
      todayMemo,
      lateNight,
      tonight,
    ].map((memo) => memo.name);
    const random = await json(
      await fetchApp("http://flaremo.test/api/app/review/random"),
    );
    expect(normalNames).toContain(random.memo.name);
    expect(random.memo.attachments).toEqual([]);

    const exhaustedRandom = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/random?exclude=${normalNames
          .map(encodeURIComponent)
          .join(",")}`,
      ),
    );
    expect(exhaustedRandom.memo).toBeNull();

    // Walk prefers a shared tag, then a relation, then a random jump.
    const tagA = await createMemo("walk start #walktag");
    const tagB = await createMemo("walk neighbor #walktag");
    const tagWalk = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/walk?memoId=${encodeURIComponent(tagA.name)}`,
      ),
    );
    expect(tagWalk.memo.name).toBe(tagB.name);
    expect(tagWalk.via).toEqual({ type: "tag", tag: "walktag" });

    const relA = await createMemo("relation walk start");
    const relB = await createMemo("relation walk target");
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${relA.name}/relations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relations: [{ related_memo: relB.name, type: "reference" }],
        }),
      }),
    );
    const relWalk = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/walk?memoId=${encodeURIComponent(relA.name)}`,
      ),
    );
    expect(relWalk.memo.name).toBe(relB.name);
    expect(relWalk.via).toEqual({ type: "relation" });

    const jumpWalk = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/walk?memoId=${encodeURIComponent(tagA.name)}&exclude=${encodeURIComponent(tagB.name)}`,
      ),
    );
    expect(jumpWalk.via).toEqual({ type: "jump" });
    expect(jumpWalk.memo.name).not.toBe(tagA.name);

    const allNormal = [
      ...normalNames,
      tagA.name,
      tagB.name,
      relA.name,
      relB.name,
    ];
    const exhaustedWalk = await json(
      await fetchApp(
        `http://flaremo.test/api/app/review/walk?memoId=${encodeURIComponent(relA.name)}&exclude=${allNormal
          .filter((name) => name !== relA.name)
          .map(encodeURIComponent)
          .join(",")}`,
      ),
    );
    expect(exhaustedWalk.memo).toBeNull();
    expect(exhaustedWalk.via).toBeNull();

    expect(
      await fetchApp(
        "http://flaremo.test/api/app/review/walk?memoId=memos/nonexistent",
      ),
    ).toMatchObject({ status: 404 });
  });

  it("serves related memos ranked by relation and shared tags", async () => {
    const source = await createMemo("related source #alpha #beta");
    const linked = await createMemo("directly linked note");
    const twoTags = await createMemo("two shared tags #alpha #beta");
    const oneTag = await createMemo("one shared tag #alpha");
    const unrelated = await createMemo("unrelated note #gamma");
    const trashed = await createMemo("trashed note #alpha");
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${source.name}/relations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relations: [{ related_memo: linked.name, type: "reference" }],
        }),
      }),
    );
    await fetchApp(`http://flaremo.test/api/v1/${trashed.name}`, {
      method: "DELETE",
    });

    const related = await json(
      await fetchApp(`http://flaremo.test/api/app/memos/${source.id}/related`),
    );
    expect(related.memos.map((memo: { name: string }) => memo.name)).toEqual([
      linked.name,
      twoTags.name,
      oneTag.name,
    ]);
    expect(related.memos[0]).toMatchObject({
      shared_tags: [],
      via_relation: true,
      attachments: [],
    });
    expect(related.memos[1]).toMatchObject({
      shared_tags: ["alpha", "beta"],
      via_relation: false,
    });
    expect(related.memos[2]).toMatchObject({
      shared_tags: ["alpha"],
      via_relation: false,
    });

    const limited = await json(
      await fetchApp(
        `http://flaremo.test/api/app/memos/${source.id}/related?limit=1`,
      ),
    );
    expect(limited.memos).toHaveLength(1);

    const reverse = await json(
      await fetchApp(`http://flaremo.test/api/app/memos/${linked.id}/related`),
    );
    expect(reverse.memos.map((memo: { name: string }) => memo.name)).toEqual([
      source.name,
    ]);
    expect(reverse.memos[0]).toMatchObject({ via_relation: true });

    const none = await json(
      await fetchApp(
        `http://flaremo.test/api/app/memos/${unrelated.id}/related`,
      ),
    );
    expect(none.memos).toEqual([]);

    expect(
      await fetchApp("http://flaremo.test/api/app/memos/nonexistent/related"),
    ).toMatchObject({ status: 404 });
  });
  it("builds today's review from age bands, remembers reads and honours mutes", async () => {
    const date = "2026-10-31";
    const setCreatedAt = (name: string, createdAt: string) =>
      env.DB.prepare("UPDATE memos SET created_at = ? WHERE id = ?")
        .bind(createdAt, name)
        .run();
    const at = async (content: string, createdAt: string) => {
      const memo = await createMemo(content);
      await setCreatedAt(memo.name, createdAt);
      return memo;
    };
    const yesterday = await at("yesterday", "2026-10-30T10:00:00.000Z");
    const week = await at("a week back", "2026-10-24T10:00:00.000Z");
    const month = await at("a month back", "2026-09-30T10:00:00.000Z");
    const quarter = await at("a quarter back", "2026-07-31T10:00:00.000Z");
    const diary = await at(
      "half a year back #diary/2026",
      "2026-04-30T10:00:00.000Z",
    );
    const lastYear = await at("last year today", "2025-10-31T10:00:00.000Z");
    const today = async (query = "") =>
      json(
        await fetchApp(
          `http://flaremo.test/api/app/review/today?date=${date}${query}`,
        ),
      );
    const names = (body: { items: Array<{ memo: { name: string } }> }) =>
      body.items.map((item) => item.memo.name);

    const first = await today();
    // Furthest first: on this day, then the ladder from oldest to newest.
    // Yesterday is too fresh to count as a memory.
    expect(names(first)).toEqual([
      lastYear.name,
      diary.name,
      quarter.name,
      month.name,
      week.name,
    ]);
    expect(names(first)).not.toContain(yesterday.name);
    expect(first.items[0].reason).toEqual({ type: "years", years: 1 });
    expect(first.items[4].reason).toEqual({ type: "ladder", days: 7 });
    expect(
      first.items.every((item: { reviewed: boolean }) => !item.reviewed),
    ).toBe(true);
    // The same day always yields the same stack.
    expect(names(await today())).toEqual(names(first));

    const mark = (memoId: string, action: string, on = date) =>
      fetchApp("http://flaremo.test/api/app/review/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoId, date: on, action }),
      });
    expect(await mark(week.name, "reviewed")).toMatchObject({ status: 200 });
    const afterRead = await today();
    expect(names(afterRead)).toContain(week.name);
    expect(
      afterRead.items.find(
        (item: { memo: { name: string } }) => item.memo.name === week.name,
      ).reviewed,
    ).toBe(true);
    // Read yesterday: it sits out the cooldown instead of coming back.
    const nextDay = await json(
      await fetchApp(
        "http://flaremo.test/api/app/review/today?date=2026-11-01",
      ),
    );
    expect(names(nextDay)).not.toContain(week.name);

    await mark(month.name, "mute");
    expect(names(await today())).not.toContain(month.name);
    const settings = await json(
      await fetchApp("http://flaremo.test/api/app/review/settings"),
    );
    expect(settings).toEqual({ excluded_tags: [], muted_count: 1 });

    // An excluded tag also covers its children.
    const updated = await json(
      await fetchApp("http://flaremo.test/api/app/review/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excludedTags: ["#diary"], restoreMuted: true }),
      }),
    );
    expect(updated).toEqual({ excluded_tags: ["diary"], muted_count: 0 });
    const filtered = names(await today());
    expect(filtered).not.toContain(diary.name);
    expect(filtered).toContain(month.name);

    expect(await mark("memos/missing", "reviewed")).toMatchObject({
      status: 404,
    });
  });
});
