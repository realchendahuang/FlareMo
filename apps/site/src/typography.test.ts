/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Typography contract for the marketing site.
 *
 * Ported from the app's `typography.test.ts`: the site has its own token file
 * and its own locale routing, so the same class of silent regression — a font
 * that never loads, a Han face named directly instead of going through
 * `:lang()`, a tracking reset written inside a cascade layer — can appear here
 * independently. Nothing was guarding it.
 */
const css = readFileSync(
  new URL("./styles/tokens.css", import.meta.url),
  "utf8",
);

function declaration(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([\\s\\S]*?);`));
  if (!match) throw new Error(`--${name} is not declared in tokens.css`);
  return match[1].replace(/\s+/g, " ").trim();
}

/** Font tiers a component may name. Removing one silently disables its rule. */
const FAMILY_TOKENS = ["font-sans", "font-heading", "font-mono"];

describe("site font tokens", () => {
  it("declares every family tier the components use", () => {
    // Tailwind emits nothing for a class whose @theme key is missing, so a
    // component that names an undeclared tier silently falls back to inherit.
    for (const token of FAMILY_TOKENS) {
      expect(() => declaration(token), token).not.toThrow();
    }
  });

  it("leads each stack with the bundled Latin face", () => {
    for (const token of FAMILY_TOKENS) {
      const stack = declaration(token);
      if (token === "font-mono") {
        expect(stack).toMatch(/^ui-monospace/);
        continue;
      }
      expect(stack, token).toMatch(/^"Geist Variable"/);
    }
  });

  it("routes Han through the language-scoped variable, never a named face", () => {
    for (const token of ["font-sans", "font-heading"]) {
      const stack = declaration(token);
      expect(stack, token).toContain("var(--font-cjk)");
      // A Han face written directly bypasses :lang() and reintroduces the
      // Chinese-glyphs-for-Japanese bug the scoping exists to prevent.
      expect(stack, token).not.toMatch(/PingFang|Hiragino|YaHei|Noto Sans CJK/);
    }
  });

  it("keeps the bundled Arabic face behind the Han faces", () => {
    const sans = declaration("font-sans");
    expect(sans.indexOf('"Noto Sans Arabic Variable"')).toBeGreaterThan(
      sans.indexOf("var(--font-cjk)"),
    );
  });
});

describe("site Han fallback scoping", () => {
  const list = (pattern: RegExp) =>
    css.match(pattern)?.[1].replace(/\s+/g, " ").trim() ?? "";

  const zh = list(/:root\s*\{[^}]*--font-cjk:\s*([\s\S]*?);/);
  const ja = list(/:root:lang\(ja\)\s*\{[^}]*--font-cjk:\s*([\s\S]*?);/);
  const ko = list(/:root:lang\(ko\)\s*\{[^}]*--font-cjk:\s*([\s\S]*?);/);

  it("scopes the Han list per script", () => {
    expect(zh).toMatch(/^"PingFang SC"/);
    expect(ja).toMatch(/Hiragino Sans|Yu Gothic/);
    expect(ko).toMatch(/Apple SD Gothic Neo|Malgun Gothic/);
    expect(ja).not.toMatch(/^"PingFang SC"/);
    expect(ko).not.toMatch(/^"PingFang SC"/);
  });

  it("lets a zh subtree switch back, not just the document root", () => {
    // The docs body is Chinese for every UI locale, and the tokens live on
    // :root — so without an element-level :lang(zh) override, Chinese body
    // text on a /ja/ page inherits the Japanese list and renders with
    // Japanese glyph forms.
    expect(css).toMatch(/:lang\(zh\)\s*\{[^}]*--font-cjk:/);
  });
});

describe("site tracking resets", () => {
  const baseEnd = css.indexOf("\n}", css.indexOf("@layer base"));
  const rtl = css.indexOf('[dir="rtl"] :is(h1, h2, h3, h4');
  const cjk = css.indexOf(
    ":is(:lang(zh), :lang(ja), :lang(ko)) :is(h1, h2, h3, h4",
  );

  it("declares both resets", () => {
    expect(rtl).toBeGreaterThan(-1);
    expect(cjk).toBeGreaterThan(-1);
  });

  it("keeps them outside @layer base", () => {
    // Zeroing must beat `.tracking-*` in @layer utilities; in CSS a later
    // layer wins regardless of specificity, so a reset written inside the base
    // layer is dead code (which is how the RTL rule shipped broken).
    expect(rtl).toBeGreaterThan(baseEnd);
    expect(cjk).toBeGreaterThan(baseEnd);
  });
});

describe("social preview image", () => {
  it("ships a 1200x630 PNG, not an SVG that scrapers cannot render", () => {
    const png = readFileSync(
      new URL("../public/og-image.png", import.meta.url),
    );
    // PNG signature: 89 50 4E 47
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe("site synthetic italic guard", () => {
  it("disables synthesis for the Han locales", () => {
    // Docs and prose render Markdown, so `*emphasis*` reaches UA `<em>`
    // italics; Han has no true italic and the browser shears the strokes.
    const match = css.match(
      /:is\(:lang\(zh\), :lang\(ja\), :lang\(ko\)\)\s*\{([^}]*)\}/,
    );
    expect(match?.[1]).toMatch(/font-synthesis:\s*none/);
  });
});
