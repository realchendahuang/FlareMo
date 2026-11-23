// node:fs is type-available under the app tsconfig and runs only in vitest's
// node runtime; this contract test reads a sibling file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/**
 * Liquid Glass baseline material contract (docs/liquid-glass-design.md).
 * The recipe is pure CSS, so these assertions pin the parts whose loss would
 * silently regress UX: the specular rim, the reduced-transparency fallback
 * and the site-wide kill switch.
 */
describe("glass material", () => {
  it("declares the material tokens in both themes", () => {
    expect(css).toMatch(/--glass-blur:/);
    expect(css).toMatch(/--glass-saturate:/);
    expect(css).toMatch(/--glass-tint:/);
    expect(css).toMatch(/--glass-rim:/);
    expect(css).toMatch(/--glass-edge:/);
    // Dark mode expresses hierarchy through tint depth, never shadows.
    expect(css).toMatch(/--glass-shadow:\s*transparent/);
  });

  it("renders the specular rim via mask composite", () => {
    expect(css).toMatch(/\.glass::after/);
    expect(css).toMatch(/-webkit-mask-composite:\s*xor/);
    expect(css).toMatch(/mask-composite:\s*exclude/);
  });

  it("degrades to the solid card surface under reduced transparency", () => {
    const start = css.indexOf("prefers-reduced-transparency: reduce");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 300);
    expect(block).toContain("backdrop-filter: none");
    expect(block).toContain("var(--card)");
  });

  it("keeps the <html data-glass=off> kill switch wired", () => {
    expect(css).toMatch(/:root\[data-glass="off"\] \.glass/);
    expect(css).toMatch(/:root\[data-glass="off"\] \.glass::after/);
  });

  it("out-ranks sonner's runtime-injected toast styling", () => {
    // sonner injects [data-sonner-toast][data-styled=true] { background: … }
    // after this sheet at the same specificity as a bare attribute+class
    // combo — the glass override must carry the [data-styled=true] key or it
    // silently loses the cascade and toasts render solid.
    expect(css).toMatch(
      /\[data-sonner-toast\]\[data-styled=(?:"true"|true)\]\.glass/,
    );
    expect(
      css.match(/\[data-sonner-toast\]\[data-styled=(?:"true"|true)\]\.glass/g),
    ).toHaveLength(3); // boost + reduced-transparency + kill switch
  });
});
