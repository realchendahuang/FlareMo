/**
 * Generates the per-accent favicon marks: public/brand/<accent>/flaremo-mark-{light-300,dark-320}.png
 *
 * The bundled marks are raster gradients (flame-400 → coral) with no vector
 * source, so each pixel is recolored in oklch space: rotate hue to the preset's
 * primary hue and scale chroma so the icon's "primary" pixel lands on the
 * preset's primary chroma. Lightness structure and the gradient's hue drift
 * are preserved, keeping every accent as faithful to its UI ramp as the
 * source art allows.
 *
 * Outputs are committed; re-run only when the source marks or the preset
 * list changes. `node scripts/generate-accent-brand.mjs` from apps/web.
 */
import { createRequire } from "node:module";
import path from "node:path";
import mkdirp from "node:fs/promises";

const require = createRequire(import.meta.url);
const sharp = await (async () => {
  try {
    return require("sharp");
  } catch {
    // pnpm hoists sharp somewhere in the workspace store; find it.
    const { readdirSync } = await import("node:fs");
    const pnpmDir = path.resolve(
      import.meta.dirname,
      "../../../node_modules/.pnpm",
    );
    const dir = readdirSync(pnpmDir).find((name) => name.startsWith("sharp@"));
    if (!dir) throw new Error("sharp not found in workspace store");
    return require(path.join(pnpmDir, dir, "node_modules", "sharp"));
  }
})();

const PRESETS = {
  // hue/chroma of each preset's primary (light step 9), from index.css ramps
  ocean: { hue: 252, chroma: 0.193 },
  indigo: { hue: 267, chroma: 0.191 },
  iris: { hue: 278, chroma: 0.184 },
  jade: { hue: 171, chroma: 0.115 },
  teal: { hue: 182, chroma: 0.114 },
  crimson: { hue: 1, chroma: 0.213 },
  amber: { hue: 84, chroma: 0.157 },
};
// flame-500, the icon gradient's mid reference
const REF_HUE = 35;
const REF_CHROMA = 0.19;

const SOURCES = ["flaremo-mark-light-300.png", "flaremo-mark-dark-320.png"];

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
function oklchToRgb(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
function rgbToOklch(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const aa = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(aa * aa + bb * bb);
  let H = (Math.atan2(bb, aa) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

async function recolor(sourcePath, outPath, deltaHue, chromaScale) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
    if (C < 0.005) continue; // neutrals (none in the mark, but stay safe)
    const [r, g, b] = oklchToRgb(L, C * chromaScale, H + deltaHue);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  await mkdirp.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(outPath);
}

const brandDir = path.resolve(import.meta.dirname, "../public/brand");
for (const [accent, { hue, chroma }] of Object.entries(PRESETS)) {
  const deltaHue = hue - REF_HUE;
  const chromaScale = chroma / REF_CHROMA;
  for (const source of SOURCES) {
    await recolor(
      path.join(brandDir, source),
      path.join(brandDir, accent, source),
      deltaHue,
      chromaScale,
    );
    console.log(`generated brand/${accent}/${source}`);
  }
}
