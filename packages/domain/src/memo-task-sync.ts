import type { FlareMoDb } from "@flaremo/db";
import { taskActivity, tasks } from "@flaremo/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement, d1RowsPerStatement } from "./d1-limits";

/**
 * A memo's to-do line and the task scheduled from it are one item seen from
 * two places: ticking either side moves the other. The link is the task's
 * `source_memo_id` plus its title, which equals the line's text (the
 * composer's schedule and the card's "convert to task" both copy the text
 * verbatim). Matching by text keeps memos plain Markdown with no hidden ids.
 */

// Same shape GFM accepts (and the web client toggles): a list marker, an
// optional indent, `[ ]`/`[x]`, then the item text.
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\](?:\s+(.*))?$/;

/** Checked state of each to-do text; the first occurrence of a text wins. */
export function memoTaskLineStates(content: string): Map<string, boolean> {
  const states = new Map<string, boolean>();
  for (const line of content.split("\n")) {
    const match = TASK_LINE_RE.exec(line);
    const text = match?.[3]?.trim();
    if (!match || !text || states.has(text)) continue;
    states.set(text, match[2] !== " ");
  }
  return states;
}

/**
 * Rewrites the first to-do line whose text equals `text` to the given state.
 * Null when no such line exists or it already has that state.
 */
export function setMemoTaskLineState(
  content: string,
  text: string,
  checked: boolean,
): string | null {
  const target = text.trim();
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = TASK_LINE_RE.exec(lines[index] ?? "");
    if (!match || match[3]?.trim() !== target) continue;
    if ((match[2] !== " ") === checked) return null;
    lines[index] = (lines[index] ?? "").replace(
      TASK_LINE_RE,
      (_all, prefix: string, _mark: string, rest?: string) =>
        `${prefix}${checked ? "x" : " "}]${rest === undefined ? "" : ` ${rest}`}`,
    );
    return lines.join("\n");
  }
  return null;
}

/**
 * After a memo edit, moves the linked tasks of every to-do line whose checked
 * state flipped. Ticking completes open tasks; unticking reopens done ones
 * (an in-progress task stays in progress). Tasks already in the target state
 * are excluded by the WHERE clause, which is also what stops the task→memo
 * direction from echoing back here.
 */
export async function syncTasksFromMemoLines(
  db: FlareMoDb,
  input: {
    userId: string;
    memoId: string;
    previousContent: string;
    nextContent: string;
    now: string;
  },
): Promise<void> {
  const before = memoTaskLineStates(input.previousContent);
  if (before.size === 0) return;
  const after = memoTaskLineStates(input.nextContent);
  const flipped: { text: string; checked: boolean }[] = [];
  for (const [text, checked] of after) {
    const previous = before.get(text);
    if (previous !== undefined && previous !== checked) {
      flipped.push({ text, checked });
    }
  }
  if (flipped.length === 0) return;

  for (const group of [true, false]) {
    const titles = flipped
      .filter((item) => item.checked === group)
      .map((item) => item.text);
    if (titles.length === 0) continue;
    const moved: { id: string }[] = [];
    // SET binds status + completedAt + updatedAt (3) and WHERE binds userId +
    // sourceMemoId + status (3), so reserve 8 parameters for fixed bindings.
    for (const titleChunk of chunkForD1(titles, d1IdsPerStatement(8))) {
      const rows = await db
        .update(tasks)
        .set({
          status: group ? "done" : "todo",
          completedAt: group ? input.now : null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(tasks.userId, input.userId),
            eq(tasks.sourceMemoId, input.memoId),
            isNull(tasks.deletedAt),
            inArray(tasks.title, titleChunk),
            group ? ne(tasks.status, "done") : eq(tasks.status, "done"),
          ),
        )
        .returning({ id: tasks.id });
      moved.push(...rows);
    }
    // 7 bound columns per inserted task_activity row.
    for (const movedChunk of chunkForD1(moved, d1RowsPerStatement(7))) {
      await insertActivity(db, input, movedChunk, group);
    }
  }
}

async function insertActivity(
  db: FlareMoDb,
  input: { userId: string; memoId: string; now: string },
  moved: { id: string }[],
  group: boolean,
) {
  await db.insert(taskActivity).values(
    moved.map((row) => ({
      taskId: row.id,
      userId: input.userId,
      actorType: "user" as const,
      actorName: null,
      action: "status_changed" as const,
      changes: {
        status: group ? "done" : "todo",
        completed_at: group ? input.now : null,
        via: input.memoId,
      },
      createdAt: input.now,
    })),
  );
}
