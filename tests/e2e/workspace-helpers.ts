import { expect, type Page } from "@playwright/test";

/**
 * Shared UI interactions for the workspace shell.
 *
 * The desktop timeline was unified under a persistent workspace layout: the
 * inline search box is gone and searching now goes through the ⌘K spotlight
 * dialog. These helpers keep every spec on the same interaction, so the next
 * time the shell changes there is one place to update instead of eight.
 */

/** The trigger that opens the spotlight search dialog: a field on wide
 *  screens, an icon on narrow ones. Both stay in the DOM, so pick the one
 *  the current viewport shows. */
export function searchTrigger(page: Page) {
  return page
    .getByRole("button", { name: /搜索记录|Search notes/i })
    .filter({ visible: true })
    .first();
}

/**
 * Fill the spotlight search box and apply the query to the timeline.
 *
 * Pressing Enter with a non-empty draft runs the "view in timeline" action,
 * which is exactly what the old inline input did on every keystroke: the
 * query lands in the workspace state and filters the visible memos.
 *
 * While a query is active the trigger renders as the query chip plus a clear
 * button instead of the "Search notes" button, so an active query is cleared
 * first. Without that, a second search in the same test could never find the
 * trigger.
 */
export async function searchTimeline(page: Page, query: string) {
  const clear = page.getByRole("button", {
    name: /清除搜索|Clear search/i,
  });
  if (await clear.count()) {
    await clear.first().click();
  }
  await searchTrigger(page).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  const input = dialog.getByPlaceholder(
    /搜索记录、任务、操作|Search notes, tasks, actions/i,
  );
  await expect(input).toBeVisible();
  await input.fill(query);
  await input.press("Enter");
  // The dialog closes on submit; the timeline behind it now carries the query.
  await expect(dialog).toHaveCount(0);
}

/** Clear the active search query through the trigger's inline clear button. */
export async function clearTimelineSearch(page: Page) {
  await page
    .getByRole("button", { name: /清除搜索|Clear search/i })
    .first()
    .click();
}

/**
 * Start the page with an empty local draft store.
 *
 * The composer persists drafts in IndexedDB under the shared browser profile.
 * Because the suite runs serially in one profile, a draft left behind by an
 * earlier test makes the next one open on a restored draft (the composer's
 * Send stays disabled on empty text). Call this at the top of a
 * test that needs the composer to start blank; tests that exercise draft
 * recovery must NOT call it.
 */
/**
 * Reset the app's persisted client state so a test starts from a clean slate.
 *
 * The suite runs serially in one shared browser profile, and the app persists
 * user preferences there — which makes otherwise-stateless tests depend on the
 * order they run in. Two real examples, both of which only reproduce in a full
 * run:
 *
 * - Composer drafts live in IndexedDB. A leftover draft makes the
 *   composer restore it (Send stays disabled on the text the test just typed).
 * - The composer's send target is remembered per space in localStorage
 *   (`flaremo.composer.visibility`). A previously-remembered `private` for the
 *   personal space overrides the team space's `protected` default, so a memo
 *   the test expects in the team timeline is filed — correctly — as personal.
 *
 * Call this before `page.goto`, in any test that depends on a clean draft or
 * on the space-derived send target. Tests that deliberately exercise draft
 * recovery or a remembered preference must NOT call it.
 */
export async function startWithCleanClientState(page: Page) {
  await page.addInitScript(async () => {
    for (const key of [
      "flaremo.composer.visibility",
      // Draft/filter affordances that would otherwise leak between tests.
      "flaremo.explorer.tags-collapsed",
      "flaremo.pwa.install-dismissed",
    ]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage may be unavailable; the test still gets a fresh document.
      }
    }

    const dbName = "flaremo-local-memo-capture";
    // Guard on existence: opening a non-existent database CREATES it, and an
    // empty same-version database makes the app's own open skip
    // `onupgradeneeded`, leaving it without its object stores.
    const existing = await indexedDB.databases();
    if (!existing.some((entry) => entry.name === dbName)) return;

    // Clear the object stores rather than deleting the database: a delete is
    // blocked while the app holds a connection and can land mid-test, wiping
    // the draft the test just created.
    const request = indexedDB.open(dbName);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      request.onerror = done;
      request.onblocked = done;
      request.onsuccess = () => {
        const db = request.result;
        const stores = ["drafts", "submission-queue"].filter((name) =>
          db.objectStoreNames.contains(name),
        );
        if (stores.length === 0) {
          db.close();
          done();
          return;
        }
        const tx = db.transaction(stores, "readwrite");
        for (const name of stores) tx.objectStore(name).clear();
        tx.oncomplete = () => {
          db.close();
          done();
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          done();
        };
      };
    });
  });
}

/**
 * The narrow-screen inline search. Below the `md` breakpoint the workspace
 * still renders a debounced input instead of the spotlight, which is where the
 * IME-composition and request-cancellation guards apply.
 */
export function mobileSearchInput(page: Page) {
  return page.getByRole("textbox", { name: /^搜索$|^Search$/i });
}

/**
 * Create a memory from the /memory page.
 *
 * The page used to open a modal with a textarea; it now grows an inline quick
 * composer. The composer defaults to the "Iron rule" tier, which locks the
 * memory on creation, so `tier` picks the starting state: "ironRule" keeps the
 * default, "preference" toggles down first so the memory is created unlocked.
 */
export async function createMemoryViaComposer(
  page: Page,
  content: string,
  tier: "ironRule" | "preference" = "ironRule",
) {
  const composer = page
    .getByPlaceholder(
      /给 AI 立一条规则或习惯|记下一条偏好或认知|Set a new rule or preference|Set a rule or habit|Note a preference or insight/i,
    )
    .first();
  await expect(composer).toBeVisible();
  // The composer starts as a plain preference; its toggle turns it into a
  // rule (the button reads 偏好 / Preference until pressed).
  if (tier === "ironRule") {
    await page
      .getByRole("button", { name: /^偏好$|^Preference$/i })
      .first()
      .click();
  }
  await composer.fill(content);
  await page
    .getByRole("button", { name: /^发送$|^Send$/i })
    .locator("visible=true")
    .first()
    .click();
}

/**
 * Open the spotlight and switch it into semantic mode, then return the dialog.
 *
 * The toggle only renders once the deployment reports a semantic-search budget
 * (`semanticEnabled`), and it stays disabled while the vector-usage query is
 * pending — clicking too early silently leaves the shell in keyword mode, so
 * the query would ride `/api/app/memos` instead of `/api/app/search/semantic`.
 * Waiting for the button to be enabled is therefore part of the contract, not
 * politeness.
 */
export async function openSemanticSearch(page: Page) {
  await searchTrigger(page).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  const toggle = dialog.getByRole("button", { name: /^语义$|^Semantic$/i });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  // Selected styling proves semantic mode is on, not merely toggled.
  await expect(toggle).toHaveAttribute("data-variant", "secondary");
  return dialog;
}
