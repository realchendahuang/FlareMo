/**
 * "Paper" material for the Worker-rendered public pages (/share/:token and
 * its unavailable page). These documents are zero-JS and never load the SPA
 * stylesheet, so the material lives here as plain CSS strings.
 *
 * The idea: a warm sheet of paper resting on a slightly darker desk. Grain is
 * an inline SVG turbulence tile (no network request, ~400 bytes), the body is
 * set in a serif with CJK Song/Mincho fallbacks, and the only color besides
 * ink is a single ember seal. Night mode is "paper under lamplight": the
 * sheet stays warm instead of going neutral gray.
 */

/** Fractal-noise tile, alpha baked into the color matrix (≈6% ink). */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .32 0 0 0 0 .25 0 0 0 0 .16 0 0 0 .075 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/** Theme colors repeated in `<meta name="theme-color">`. */
export const PAPER_THEME_COLOR = { light: "#ebe4d6", dark: "#151310" } as const;

export const PAPER_TOKENS = `
:root {
  color-scheme: light dark;
  --desk: ${PAPER_THEME_COLOR.light};
  --sheet: #fbf8f1;
  --ink: #2a241c;
  --ink-soft: #5f564a;
  --ink-faint: #958a7a;
  --rule: rgba(90, 70, 40, .14);
  --seal: #c2410c;
  --seal-soft: rgba(194, 65, 12, .1);
  --shadow:
    0 1px 1px rgba(70, 50, 20, .05),
    0 6px 14px -6px rgba(70, 50, 20, .14),
    0 28px 60px -28px rgba(70, 50, 20, .28);
  --grain: ${GRAIN};
}
@media (prefers-color-scheme: dark) {
  :root {
    --desk: ${PAPER_THEME_COLOR.dark};
    --sheet: #201c17;
    --ink: #ebe3d4;
    --ink-soft: #b9ae9c;
    --ink-faint: #82786a;
    --rule: rgba(235, 220, 190, .12);
    --seal: #f08a4b;
    --seal-soft: rgba(240, 138, 75, .12);
    --shadow: 0 0 0 1px rgba(255, 240, 210, .05), 0 30px 60px -30px rgba(0, 0, 0, .7);
  }
}
* { box-sizing: border-box; }
/* Han fallbacks follow <html lang> (see detectShareLang): Song/Mincho for the
   serif voice, each script on its own glyph forms. A subtree that declares
   zh again (the Chinese chrome on a Japanese note) switches back via :lang. */
:root {
  --serif-cjk: "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", SimSun;
  --sans-cjk: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei";
}
:root:lang(ja) {
  --serif-cjk: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Noto Serif CJK JP", "Songti SC";
  --sans-cjk: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", "PingFang SC";
}
:root:lang(ko) {
  --serif-cjk: "AppleMyungjo", "Nanum Myeongjo", "Noto Serif KR", "Noto Serif CJK KR", Batang, "Songti SC";
  --sans-cjk: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "PingFang SC";
}
:lang(zh) {
  --serif-cjk: "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", SimSun;
  --sans-cjk: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei";
}
html { background: var(--desk) var(--grain); }
body {
  margin: 0;
  min-height: 100svh;
  color: var(--ink);
  font: 400 17px/1.9 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, var(--serif-cjk), serif;
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
::selection { background: var(--seal-soft); }
.ui { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", var(--sans-cjk), system-ui, sans-serif; }
`;

export const PAPER_PAGE_STYLES = `${PAPER_TOKENS}
.desk { padding: clamp(1rem, 5vw, 4.5rem) clamp(.75rem, 4vw, 2rem) 3rem; }
.sheet {
  position: relative;
  max-width: 40rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 4rem) clamp(1.4rem, 6vw, 4.25rem) clamp(2.25rem, 6vw, 3.75rem);
  background: var(--sheet) var(--grain);
  border-radius: 3px;
  box-shadow: var(--shadow);
}
/* A second, slightly rotated sheet peeking out underneath: a stack of paper,
   not a card. Hidden on narrow screens where the margin cannot show it. */
.sheet::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--sheet);
  border-radius: 3px;
  box-shadow: var(--shadow);
  transform: rotate(-1.1deg) translate(-4px, 6px);
  opacity: .7;
}
@media (max-width: 40rem) { .sheet::before { display: none; } }
.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: clamp(1.75rem, 5vw, 2.75rem);
  font-size: .78rem;
  letter-spacing: .04em;
  color: var(--ink-faint);
}
.masthead a { color: inherit; text-decoration: none; display: inline-flex; align-items: center; gap: .5rem; }
.masthead a:hover { color: var(--ink-soft); }
.seal {
  display: inline-block;
  width: .5rem;
  height: .5rem;
  border-radius: 50%;
  background: var(--seal);
  box-shadow: 0 0 0 3px var(--seal-soft);
}
.postmark { font-variant-numeric: tabular-nums; }
article { overflow-wrap: break-word; hanging-punctuation: first; }
article > :first-child { margin-top: 0; }
article h1, article h2, article h3, article h4, article h5, article h6 {
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -.005em;
  margin: 1.9em 0 .7em;
  text-wrap: balance;
}
article h1 { font-size: 1.85rem; margin-top: 0; }
.article-title {
  font-size: 1.85rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -.01em;
  margin: 0 0 1.2em;
  text-wrap: balance;
  overflow-wrap: break-word;
}
article h2 { font-size: 1.35rem; }
article h3 { font-size: 1.12rem; }
article p { margin: 0 0 1.05em; text-wrap: pretty; }
article strong { font-weight: 650; }
article a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--seal); text-decoration-thickness: 1px; text-underline-offset: .22em; }
article a:hover { color: var(--seal); }
article img { display: block; max-width: 100%; height: auto; margin: 1.6em auto; border-radius: 2px; box-shadow: 0 1px 2px rgba(60, 40, 10, .12), 0 10px 24px -14px rgba(60, 40, 10, .35); }
article blockquote { margin: 1.5em 0; padding-block: .1em; padding-inline: 1.2em 0; border-inline-start: 2px solid var(--seal); color: var(--ink-soft); font-style: italic; }
:is(:lang(zh), :lang(ja), :lang(ko)) article blockquote { font-style: normal; }
article pre { margin: 1.4em 0; padding: 1em 1.15em; background: rgba(120, 95, 55, .07); border: 1px solid var(--rule); border-radius: 4px; overflow-x: auto; font-size: .82rem; line-height: 1.65; }
article code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, var(--sans-cjk), monospace; font-size: .84em; background: rgba(120, 95, 55, .09); padding: .12em .36em; border-radius: 3px; }
article pre code { background: transparent; padding: 0; font-size: inherit; }
article table { border-collapse: collapse; width: 100%; margin: 1.4em 0; font-size: .9rem; }
article th, article td { border-bottom: 1px solid var(--rule); padding: .5em .6em; text-align: start; }
article th { font-weight: 600; border-bottom-color: var(--ink-faint); }
article h1, article h2, article h3 { scroll-margin-top: 1rem; }
article hr { border: none; margin: 2.4em 0; text-align: center; }
article hr::after { content: "· · ·"; letter-spacing: .6em; color: var(--ink-faint); }
article ul, article ol { padding-inline-start: 1.5em; margin: 0 0 1.05em; }
article li { margin: .25em 0; }
article li::marker { color: var(--ink-faint); }
article li:has(> input[type=checkbox]) { list-style: none; margin-inline-start: -1.5em; }
/* Task boxes are drawn, not native: a disabled native checkbox renders in
   the OS's grey, which reads as "broken" on paper. A hand-ruled square,
   ticked in ember. */
article li input[type=checkbox] {
  appearance: none;
  width: .95em;
  height: .95em;
  margin: 0;
  margin-inline-end: .4em;
  vertical-align: -.1em;
  border: 1.5px solid var(--ink-faint);
  border-radius: 3px;
  background: transparent;
  display: inline-grid;
  place-content: center;
}
article li input[type=checkbox]:checked { border-color: var(--seal); }
article li input[type=checkbox]:checked::after {
  content: "";
  width: .32em;
  height: .58em;
  margin-top: -.12em;
  border: solid var(--seal);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
article li:has(> input[type=checkbox]:checked) { color: var(--ink-soft); }
article blockquote > :last-child { margin-bottom: 0; }
.gallery { margin-top: 2.4em; }
.gallery-item { margin: 1.6em 0; }
.gallery-item img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 2px; box-shadow: 0 1px 2px rgba(60, 40, 10, .12), 0 10px 24px -14px rgba(60, 40, 10, .35); }
.gallery-item figcaption { margin-top: .6rem; text-align: center; color: var(--ink-faint); font-size: .8rem; }
.gallery hr { border: none; margin: 2.4em 0 0; text-align: center; }
.gallery hr::after { content: "· · ·"; letter-spacing: .6em; color: var(--ink-faint); }
audio { width: 100%; margin: .6em 0; }
.muted { color: var(--ink-faint); }
.sheet > footer {
  margin-top: clamp(2.5rem, 7vw, 3.5rem);
  padding-top: 1.25rem;
  border-top: 1px solid var(--rule);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: .4rem 1rem;
  color: var(--ink-soft);
}
.sheet > footer .author { font-size: 1.02rem; }
.sheet > footer .author::before { content: "— "; color: var(--ink-faint); }
.sheet > footer time { font-size: .8rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.colophon { max-width: 40rem; margin: 1.5rem auto 0; text-align: center; font-size: .75rem; color: var(--ink-faint); letter-spacing: .04em; }
.colophon a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--rule); padding-bottom: 1px; }
.colophon a:hover { color: var(--seal); border-bottom-color: var(--seal); }
/* Shiki dual themes (article pages): colors arrive as CSS variables. The
   paper keeps showing through instead of the theme's flat background. */
article pre.shiki { background-color: rgba(120, 95, 55, .07) !important; }
article pre.shiki span { color: var(--shiki-light); }
@media (prefers-color-scheme: dark) {
  article pre.shiki span { color: var(--shiki-dark); }
}
@media print {
  html { background: none; }
  .sheet { box-shadow: none; padding: 0; background: none; }
  .sheet::before, .colophon { display: none; }
}
`;

export const PAPER_UNAVAILABLE_STYLES = `${PAPER_TOKENS}
body { display: grid; place-items: center; padding: 1.5rem; }
.note {
  max-width: 22rem;
  padding: 2.25rem 2rem 2rem;
  background: var(--sheet) var(--grain);
  border-radius: 3px;
  box-shadow: var(--shadow);
  text-align: center;
  transform: rotate(-.6deg);
}
.note .seal { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: var(--seal); box-shadow: 0 0 0 3px var(--seal-soft); margin-bottom: 1.1rem; }
.note p { margin: 0; color: var(--ink-soft); }
.note p + p { margin-top: .9rem; font-size: .78rem; letter-spacing: .04em; color: var(--ink-faint); }
.note a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--rule); }
`;

/**
 * "2026年10月29日" for the signature line. UTC like the rest of the page:
 * the Worker has no viewer timezone, and the machine-readable <time datetime>
 * carries the exact instant.
 */
export function paperDateZh(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

/** "2026 · 10 · 29" for the masthead postmark. */
export function paperPostmark(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()} · ${pad(date.getUTCMonth() + 1)} · ${pad(date.getUTCDate())}`;
}
