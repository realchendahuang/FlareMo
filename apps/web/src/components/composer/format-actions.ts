import type { Editor } from "@tiptap/react";

/**
 * Text formatting shared by the composer toolbar and the selection bubble
 * menu, so the two surfaces can never disagree about what a button does or
 * which shortcut it advertises. Every action maps to a StarterKit command and
 * serializes to plain GFM (`**`, `*`, `~~`, `` ` ``, `##`, `>`, fences).
 */
export type FormatId =
  | "heading"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "quote"
  | "codeBlock"
  | "bulletList"
  | "orderedList"
  | "taskList";

export type ActiveFormats = Record<FormatId, boolean>;

export const NO_ACTIVE_FORMATS: ActiveFormats = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  quote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
};

/** Memos use one heading size; H2 reads as a title without shouting. */
export const COMPOSER_HEADING_LEVEL = 2;

export function readActiveFormats(editor: Editor): ActiveFormats {
  return {
    heading: editor.isActive("heading"),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    link: editor.isActive("link"),
    quote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
  };
}

export function sameActiveFormats(a: ActiveFormats, b: ActiveFormats) {
  return (Object.keys(a) as FormatId[]).every((key) => a[key] === b[key]);
}

/** Runs one formatting toggle. Link is not here: it needs a URL first. */
export function toggleFormat(
  editor: Editor,
  id: Exclude<FormatId, "link">,
): void {
  const chain = editor.chain().focus();
  switch (id) {
    case "heading":
      chain.toggleHeading({ level: COMPOSER_HEADING_LEVEL }).run();
      return;
    case "bold":
      chain.toggleBold().run();
      return;
    case "italic":
      chain.toggleItalic().run();
      return;
    case "strike":
      chain.toggleStrike().run();
      return;
    case "code":
      chain.toggleCode().run();
      return;
    case "quote":
      chain.toggleBlockquote().run();
      return;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      return;
    case "bulletList":
      chain.toggleBulletList().run();
      return;
    case "orderedList":
      chain.toggleOrderedList().run();
      return;
    case "taskList":
      chain.toggleTaskList().run();
      return;
  }
}

export const IS_APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MOD = IS_APPLE ? "⌘" : "Ctrl+";
const SHIFT = IS_APPLE ? "⇧" : "Shift+";
const ALT = IS_APPLE ? "⌥" : "Alt+";

/**
 * StarterKit's default key bindings, written the way the platform writes
 * them. Shown in tooltips so the buttons teach the keyboard.
 */
export const FORMAT_SHORTCUTS: Partial<Record<FormatId, string>> = {
  heading: `${MOD}${ALT}${COMPOSER_HEADING_LEVEL}`,
  bold: `${MOD}B`,
  italic: `${MOD}I`,
  strike: `${MOD}${SHIFT}S`,
  code: `${MOD}E`,
  quote: `${MOD}${SHIFT}B`,
  codeBlock: `${MOD}${ALT}C`,
};

/**
 * Turns what the author typed into an href. Bare domains get `https://`;
 * absolute URLs, in-app paths, anchors, mailto and tel pass through. The
 * Link extension still validates the result (it refuses `javascript:`).
 */
export function normalizeHref(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+([/?#:].*)?$/.test(value)) return `https://${value}`;
  return value;
}
