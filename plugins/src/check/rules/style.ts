import { isUnsafeCSS } from "../../document";
import { isPlainObject } from "../../validate";
import type { Checker } from "../checker";
import {
  BUILT_IN_FONT_FAMILIES,
  FONT_ALIGNS,
  FONT_KEYS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_TRACKING_MAX,
  STYLE_KEYS,
} from "../constants";
import { checkColorValue } from "./color";
import { checkFontNumber, checkLineHeight } from "./font";
export function checkStyle(
  checker: Checker,
  style: unknown,
  where: string,
  nodeTranslatable = false,
): void {
  if (style === undefined) return;
  if (!isPlainObject(style)) {
    checker.error("style/invalid", `${where}: style must be an object`);
    return;
  }
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) {
      checker.warn(
        "style/unknown-key",
        `${where}.${key}: unknown style key (ignored at render time)`,
      );
    }
  }
  for (const key of ["background", "borderColor", "color"] as const) {
    if (style[key] !== undefined) {
      checkColorValue(checker, style[key], `${where}.${key}`);
    }
  }
  for (const key of ["backgroundCSS", "shadowCSS"] as const) {
    const raw = style[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      checker.error("style/invalid", `${where}.${key}: must be a string`);
    } else if (isUnsafeCSS(raw)) {
      checker.error(
        "style/unsafe",
        `${where}.${key}: url()/expression()/javascript: are not allowed`,
      );
    } else if (key === "backgroundCSS" && !/gradient\(/i.test(raw)) {
      checker.warn(
        "style/suspicious",
        `${where}.${key}: expected a CSS gradient (e.g. linear-gradient(...))`,
      );
    }
  }
  if (style.shadow !== undefined) {
    const allowed = new Set(["none", "sm", "md", "lg"]);
    if (typeof style.shadow !== "string" || !allowed.has(style.shadow)) {
      checker.error(
        "style/invalid",
        `${where}.shadow: must be one of none/sm/md/lg (use shadowCSS for a custom value)`,
      );
    }
  }
  if (style.clamp !== undefined) {
    if (typeof style.clamp !== "number" || style.clamp < 1) {
      checker.error(
        "style/invalid",
        `${where}.clamp: must be a positive number of lines`,
      );
    }
  }
  const font = style.font;
  if (font !== undefined) {
    if (!isPlainObject(font)) {
      checker.error("style/invalid", `${where}.font: must be an object`);
    } else {
      for (const key of Object.keys(font)) {
        if (!FONT_KEYS.has(key)) {
          checker.warn(
            "style/unknown-key",
            `${where}.font.${key}: unknown font key (ignored at render time)`,
          );
        }
      }
      const family = font.family;
      if (family !== undefined) {
        if (typeof family !== "string" || !BUILT_IN_FONT_FAMILIES.has(family)) {
          const familyLabel =
            typeof family === "string"
              ? family
              : (JSON.stringify(family) ?? typeof family);
          checker.warn(
            "font/unsupported",
            `${where}.font.family: "${familyLabel}" is not a built-in family (${[...BUILT_IN_FONT_FAMILIES].join("/")}); packaged fonts are not supported yet, the card will fall back`,
          );
        }
      }
      // The numeric/size fields reach the renderer as inline styles, so an
      // out-of-range value is not clamped away — it renders (or silently drops
      // the declaration) and, for exported cards, bakes into the PNG.
      checkFontNumber(checker, font.size, `${where}.font.size`, {
        min: FONT_SIZE_MIN,
        max: FONT_SIZE_MAX,
        unit: "px",
        integer: false,
      });
      checkFontNumber(checker, font.weight, `${where}.font.weight`, {
        min: 1,
        max: 1000,
        unit: "",
        integer: true,
      });
      checkFontNumber(
        checker,
        font.letterSpacing,
        `${where}.font.letterSpacing`,
        {
          min: -FONT_TRACKING_MAX,
          max: FONT_TRACKING_MAX,
          unit: "px",
          integer: false,
        },
      );
      checkLineHeight(checker, font.lineHeight, `${where}.font.lineHeight`);
      if (font.align !== undefined && !FONT_ALIGNS.has(font.align as string)) {
        checker.error(
          "style/invalid",
          `${where}.font.align: must be one of ${[...FONT_ALIGNS].join("/")}`,
        );
      }
      if (font.uppercase !== undefined && typeof font.uppercase !== "boolean") {
        checker.error(
          "style/invalid",
          `${where}.font.uppercase: must be a boolean`,
        );
      }
      // Han text ignores tracking at render time (see isHanLocale), so a card
      // that sets it on translatable content is not broken — just expressing
      // something that will not happen in zh/ja/ko, which is worth knowing.
      if (
        typeof font.letterSpacing === "number" &&
        font.letterSpacing !== 0 &&
        nodeTranslatable
      ) {
        checker.warn(
          "font/tracking-ignored-for-han",
          `${where}.font.letterSpacing: dropped for zh/ja/ko, whose text ignores card tracking; only Latin-only cards will show it`,
        );
      }
      if (font.color !== undefined) {
        checkColorValue(checker, font.color, `${where}.font.color`);
      }
    }
  }
}
