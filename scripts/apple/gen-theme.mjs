#!/usr/bin/env node
/**
 * 设计 token 生成器：apps/web/src/index.css → FlareMoDesign/Generated/Theme.swift
 *
 * 为什么生成而不是手抄：颜色只有一处事实源（Web 的 Ember token），手抄必然漂。
 * oklch 是 CSS Color 4 的写法，Apple 平台没有对应类型，所以在这里做
 * oklch → oklab → linear sRGB → sRGB gamma 的转换，输出 0–255 整数分量。
 *
 * 用法：
 *   node scripts/apple/gen-theme.mjs            # 生成
 *   node scripts/apple/gen-theme.mjs --check    # 只校验生成物是否最新（CI/门禁用）
 *
 * 相关文档：docs/native-clients.md §7.2、docs/design-system.md（字体与排版、形状与层级、动效）。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CSS_PATH = resolve(REPO, "apps/web/src/index.css");
const OUT_PATH = resolve(
  REPO,
  "packages/apple/FlareMoKit/Sources/FlareMoDesign/Generated/Theme.swift",
);
const KT_OUT_PATH = resolve(
  REPO,
  "packages/kotlin/shared/ui/src/commonMain/kotlin/dev/flaremo/ui/theme/Theme.kt",
);

/* ------------------------------------------------------------------ *
 * 1. 解析 CSS
 * ------------------------------------------------------------------ */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 极简 CSS 规则解析器。只服务本仓库的 index.css：
 * 不需要支持嵌套选择器、`&`、容器查询等——碰到就跳过，宁可漏也不猜。
 * 返回 [{ selector, atRules: string[], body: string }]
 */
function parseRules(css) {
  const rules = [];
  const stack = [];
  let prelude = "";
  let decls = "";
  let i = 0;

  const collecting = () => stack.length > 0 && stack[stack.length - 1].collect;

  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      const isAt = head.startsWith("@");
      // 只有选择器块与 @theme 块能装声明；@layer/@media 只是容器。
      stack.push({
        selector: head,
        isAt,
        collect: !isAt || head.startsWith("@theme"),
      });
      if (collecting()) decls = "";
      i++;
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame?.collect) {
        rules.push({
          selector: frame.selector,
          atRules: stack.filter((f) => f.isAt).map((f) => f.selector),
          body: decls,
        });
      }
      prelude = "";
      decls = "";
      i++;
      continue;
    }
    if (ch === ";") {
      if (collecting()) decls += `${prelude.trim()};`;
      prelude = "";
      i++;
      continue;
    }
    if (collecting()) decls += ch;
    else prelude += ch;
    i++;
  }
  return rules;
}

/** 按括号深度切分，避免 var(...)/oklch(...) 里的逗号与分号被误切。 */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function declarationsOf(body) {
  const map = new Map();
  for (const decl of splitTopLevel(body, ";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const name = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (name.startsWith("--")) map.set(name, value);
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * 2. 色彩空间转换：oklch → sRGB
 *    公式来源：CSS Color 4 / Björn Ottosson 的 oklab 参考实现
 * ------------------------------------------------------------------ */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function parseOklch(value) {
  const match = value.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/,
  );
  if (!match) return null;
  const [, lRaw, cRaw, hRaw, aRaw] = match;
  const num = (raw, scale = 1) =>
    raw === undefined
      ? undefined
      : raw.endsWith("%")
        ? (parseFloat(raw) / 100) * scale
        : parseFloat(raw);
  return {
    lightness: num(lRaw),
    chroma: num(cRaw, 0.4),
    hue: parseFloat(hRaw),
    alpha: aRaw === undefined ? 1 : num(aRaw) > 1 ? num(aRaw) / 100 : num(aRaw),
  };
}

function oklchToSRGB({ lightness: L, chroma: C, hue: H, alpha }) {
  const hueRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hueRad);
  const b = C * Math.sin(hueRad);

  const lPrime = L + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = L - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = L - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linear = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const gamma = (v) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  const [r, g, bl] = linear.map((v) =>
    Math.round(clamp01(gamma(clamp01(v))) * 255),
  );

  return { r, g, b: bl, a: Number(clamp01(alpha).toFixed(4)) };
}

/* ------------------------------------------------------------------ *
 * 3. 取值：把 var(--x) 展开、合并 :root 与 .dark
 * ------------------------------------------------------------------ */

function resolveValue(prop, layerOwn, fallback, seen = new Set()) {
  if (seen.has(prop)) throw new Error(`--${prop} 存在循环 var() 引用`);
  seen.add(prop);
  const raw = layerOwn.get(prop) ?? fallback.get(prop);
  if (raw === undefined) return undefined;
  const varMatch = raw.match(/^var\(\s*--([\w-]+)\s*\)$/);
  if (varMatch)
    return resolveValue(`--${varMatch[1]}`, layerOwn, fallback, seen);
  return raw;
}

function parseColorValue(raw, prop) {
  if (raw === undefined) throw new Error(`缺少 token --${prop}`);
  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const oklch = parseOklch(raw);
  if (oklch) return oklchToSRGB(oklch);
  throw new Error(
    `--${prop} 的值「${raw}」不是 oklch() 或 transparent，生成器不认这种写法`,
  );
}

const px = (raw) => {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "0") return 0;
  if (value.endsWith("px")) return parseFloat(value);
  if (value.endsWith("rem")) return parseFloat(value) * 16;
  throw new Error(`看不懂的长度值：${value}`);
};

const ms = (raw) => {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value.endsWith("ms")) return parseFloat(value);
  if (value.endsWith("s")) return parseFloat(value) * 1000;
  throw new Error(`看不懂的时长值：${value}`);
};

function parseCubicBezier(raw, prop) {
  const match = raw?.match(
    /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/,
  );
  if (!match) throw new Error(`${prop} 不是 cubic-bezier：${raw}`);
  return match.slice(1, 5).map(Number);
}

/** 解析 `0 1px 2px oklch(...)` 这类阴影，返回层数组（CSS 的 spread SwiftUI 没有对应项，保留数值）。 */
function parseShadow(raw, prop) {
  if (raw === undefined) return [];
  if (raw === "transparent" || raw === "none") return [];
  return splitTopLevel(raw, ",").map((layer) => {
    const colorMatch = layer.match(
      /(oklch\([^)]*\)|transparent|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*$/,
    );
    if (!colorMatch) throw new Error(`--${prop} 的阴影层缺颜色：${layer}`);
    const color = parseColorValue(colorMatch[1], prop);
    const lengths = layer
      .slice(0, colorMatch.index)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(px);
    if (lengths.length < 3)
      throw new Error(`--${prop} 的阴影层长度不足：${layer}`);
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return { x, y, blur, spread, color };
  });
}

/* ------------------------------------------------------------------ *
 * 4. 主流程
 * ------------------------------------------------------------------ */

const css = stripComments(readFileSync(CSS_PATH, "utf8"));
const rules = parseRules(css);

const findDecls = (selector) => {
  const rule = rules.find(
    (r) => r.selector === selector && r.atRules.length === 0,
  );
  if (!rule) throw new Error(`index.css 里找不到顶层 ${selector} 规则`);
  return declarationsOf(rule.body);
};

const light = findDecls(":root");
const darkOwn = findDecls(".dark");

// @theme inline 里放的是 Tailwind 的别名与动效曲线（--ease-*），
// 它们不在 :root 里，取标量时要一起看。
const themeRule = rules.find(
  (r) => r.selector === "@theme inline" && r.atRules.length === 0,
);
const themeDecls = themeRule ? declarationsOf(themeRule.body) : new Map();
/** 取标量 token：先看 :root，再看 @theme inline。 */
const scalar = (prop) => light.get(prop) ?? themeDecls.get(prop);

const colorToken = (prop) => {
  const lightRaw = resolveValue(prop, light, new Map());
  const darkRaw = resolveValue(prop, darkOwn, light);
  return {
    light: parseColorValue(lightRaw, prop),
    dark: parseColorValue(darkRaw, prop),
  };
};

/** Swift 命名：`--card-foreground` → `cardForeground` */
const camel = (cssName) =>
  cssName
    .replace(/^--/, "")
    .split("-")
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");

const COLOR_GROUPS = [
  {
    title: "品牌色阶",
    note: "火焰橙 → 珊瑚，来自 logo 渐变采样。品牌色只用于主操作、激活态与置顶标记，不铺大面积。",
    tokens: [
      "--brand-50",
      "--brand-100",
      "--brand-200",
      "--brand-300",
      "--brand-400",
      "--brand-500",
      "--brand-600",
      "--brand-700",
      "--brand-coral",
    ],
  },
  {
    title: "表面与文字",
    note: "暖中性承担约 90% 的面积。暗色不用阴影表达层级，靠表面明度阶梯（0.158 / 0.207 / 0.232）。",
    tokens: [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--secondary",
      "--secondary-foreground",
      "--accent",
      "--accent-foreground",
      "--muted",
      "--muted-foreground",
    ],
  },
  {
    title: "交互与状态",
    note: "primary 在暗色指向 brand-400（更亮），保证暗底上仍有足够对比。",
    tokens: [
      "--primary",
      "--primary-foreground",
      "--destructive",
      "--success",
      "--success-foreground",
      "--warning",
      "--warning-foreground",
      "--info",
      "--info-foreground",
      "--success-emphasis",
      "--warning-emphasis",
      "--info-emphasis",
    ],
  },
  {
    title: "描边",
    note: "分隔一律发丝线，不要粗边框。",
    tokens: ["--border", "--input", "--ring"],
  },
  {
    title: "玻璃材质",
    note: "中性玻璃：accent 预设永不染色玻璃。带 alpha，叠在 NSVisualEffectView / .ultraThinMaterial 之上。",
    tokens: ["--glass-tint", "--glass-rim", "--glass-edge", "--glass-shadow"],
  },
];

const fmtRGBA = (c) =>
  `FMRGBA(red: ${c.r}, green: ${c.g}, blue: ${c.b}, alpha: ${c.a})`;

const colorGroups = COLOR_GROUPS.map((group) => {
  const entries = group.tokens.map((prop) => {
    const token = colorToken(prop);
    return `    /// \`${prop}\`\n    public static let ${camel(prop)} = FMColorToken(\n        light: ${fmtRGBA(token.light)},\n        dark: ${fmtRGBA(token.dark)}\n    )`;
  });
  return `    // MARK: ${group.title}\n\n    /// ${group.note}\n${entries.join("\n\n")}`;
}).join("\n\n");

/** 所有颜色 token 收在一个 enum 里：Swift 不允许同模块内重名类型。 */
const colorSection = `/// Ember 配色的全部颜色 token。每一项都是亮/暗成对的，跟随系统外观解析。\npublic enum FMColor {\n${colorGroups}\n}`;

/** 每个颜色再给一个 ShapeStyle 静态量，调用处可写 backgroundColor(.fmBackground)。 */
const shapeStyleSection = `extension ShapeStyle where Self == Color {\n${COLOR_GROUPS.flatMap(
  (g) => g.tokens,
)
  .map(
    (prop) =>
      `    /// FMColor.${camel(prop)}\n    public static var fm${camel(prop).charAt(0).toUpperCase() + camel(prop).slice(1)}: Color { FMColor.${camel(prop)}.color }`,
  )
  .join("\n\n")}\n}`;

// 圆角：--radius 是基准，@theme 里的倍数是官方阶梯（sm 0.6 / md 0.8 / lg 1 / xl 1.4 / 2xl 1.8 / 3xl 2.2 / 4xl 2.6）
const radiusBase = px(light.get("--radius"));
const radiusMultipliers = new Map();
if (themeRule) {
  for (const [name, value] of declarationsOf(themeRule.body)) {
    const match = name.match(/^--radius-([\w]+)$/);
    if (!match) continue;
    const factor = value.match(/calc\(\s*var\(--radius\)\s*\*\s*([\d.]+)\s*\)/);
    if (factor) radiusMultipliers.set(match[1], parseFloat(factor[1]));
  }
}

const radiusNames = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
/** CSS 的 `2xl` 不是合法 Swift 标识符，转成 `xxl`（3xl→xxxl，4xl→xxxxl）。 */
const swiftRadiusName = (name) =>
  name.replace(/^(\d)xl$/, (_, digits) => "x".repeat(Number(digits)));
const radiusSection = radiusNames
  .map((name) => {
    const factor =
      radiusMultipliers.get(name) ?? (name === "lg" ? 1 : undefined);
    if (factor === undefined) return null;
    return `    /// \`--radius-${name}\` = ${radiusBase}pt × ${factor} = ${(radiusBase * factor).toFixed(2)}pt\n    public static let ${swiftRadiusName(name)}: CGFloat = ${Number((radiusBase * factor).toFixed(2))}`;
  })
  .filter(Boolean)
  .join("\n\n");

// 阴影
const shadowPropNames = [
  "--shadow-xs",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
];
const shadowSection = shadowPropNames
  .map((prop) => {
    const name = prop.replace("--shadow-", "");
    const lightLayers = parseShadow(resolveValue(prop, light, new Map()), prop);
    const darkLayers = parseShadow(resolveValue(prop, darkOwn, light), prop);
    const render = (layers) => {
      if (layers.length === 0) return "[]";
      return `[\n${layers.map((l) => `            FMShadowLayer(x: ${l.x}, y: ${l.y}, blur: ${l.blur}, spread: ${l.spread}, rgba: FMRGBA(red: ${l.color.r}, green: ${l.color.g}, blue: ${l.color.b}, alpha: ${l.color.a}))`).join(",\n")}\n        ]`;
    };
    return `    /// \`${prop}\`，暗色下三层全部归零（层级改由表面明度表达）\n    public static let ${name} = FMShadowToken(\n        light: ${render(lightLayers)},\n        dark: ${render(darkLayers)}\n    )`;
  })
  .join("\n\n");

// 动效
const motionSection = [
  ["feedback", "--duration-fast", "交互反馈（hover、按压、开关）"],
  ["overlay", "--duration-overlay", "浮层（菜单、popover、tooltip）"],
  ["surface", "--duration-surface", "表面（弹窗、抽屉、页面入场）"],
]
  .map(([name, prop, note]) => {
    const value = ms(scalar(prop));
    return `    /// ${note}：\`${prop}\`\n    public static let ${name} = FMDuration(milliseconds: ${value})`;
  })
  .concat(
    [
      ["expo", "--ease-out-expo", "长尾减速，入场"],
      ["signal", "--ease-signal", "KOSX 签名曲线，默认用它"],
      ["spring", "--ease-spring", "微小弹跳，只给 <140ms 的小元素"],
    ].map(([name, prop, note]) => {
      const [x1, y1, x2, y2] = parseCubicBezier(scalar(prop), prop);
      return `    /// ${note}：\`${prop}\`\n    public static let ${name} = FMCurve(x1: ${x1}, y1: ${y1}, x2: ${x2}, y2: ${y2})`;
    }),
  )
  .join("\n\n");

const glassBlur = px(light.get("--glass-blur"));
const glassSaturate = parseFloat(light.get("--glass-saturate"));

/* ------------------------------------------------------------------ *
 * 5. 输出 Swift
 * ------------------------------------------------------------------ */

const swift = `// 本文件由 scripts/apple/gen-theme.mjs 从 apps/web/src/index.css 生成，请勿手改。
// 重新生成：node scripts/apple/gen-theme.mjs（或 pnpm apple:theme）
//
// 为什么原生端不手写色值：Web 的 Ember token 是唯一事实源，手抄必然漂。
// 生成器做三件事：展开 var() → 合并 :root/.dark → oklch 转 sRGB。

import Foundation
import SwiftUI

// MARK: - 基础类型

/// 一个 sRGB 颜色，分量是 0–255 整数、alpha 是 0–1。
/// 用整数而不是浮点：生成的代码更短，且能和设计稿里的十六进制逐位对上。
public struct FMRGBA: Sendable, Hashable {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8
    public let alpha: Double

    public init(red: UInt8, green: UInt8, blue: UInt8, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// 不透明时输出 \`#rrggbb\`，有 alpha 时输出 \`#rrggbbaa\`（设计对照、快照测试断言用）。
    public var hex: String {
        let base = String(format: "#%02x%02x%02x", red, green, blue)
        guard alpha < 1 else { return base }
        return base + String(format: "%02x", Int((alpha * 255).rounded()))
    }

    #if os(macOS)
    public var platform: NSColor {
        NSColor(srgbRed: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: CGFloat(alpha))
    }
    #else
    public var platform: UIColor {
        UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: CGFloat(alpha))
    }
    #endif
}

/// 亮/暗成对的颜色 token。解析是懒的：跟随系统外观自动切换，不缓存。
public struct FMColorToken: Sendable {
    public let light: FMRGBA
    public let dark: FMRGBA

    public init(light: FMRGBA, dark: FMRGBA) {
        self.light = light
        self.dark = dark
    }

    /// 跟随系统外观的 SwiftUI 颜色。
    public var color: Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return (isDark ? dark : light).platform
        })
        #else
        Color(uiColor: UIColor { traits in
            (traits.userInterfaceStyle == .dark ? dark : light).platform
        })
        #endif
    }

    /// 指定外观取色（快照测试固定 light/dark 用，正常界面用 \`color\`）。
    public func color(for colorScheme: ColorScheme) -> Color {
        (colorScheme == .dark ? dark : light).platform.swiftUIColor
    }
}

/// 一层阴影。CSS 的 \`spread\` 在 SwiftUI 没有对应参数，数值保留下来，
/// 由 \`View.fmShadow(_:)\` 用「放大 blur 抵消 spread」的方式近似。
public struct FMShadowLayer: Sendable, Hashable {
    public let x: CGFloat
    public let y: CGFloat
    public let blur: CGFloat
    public let spread: CGFloat
    public let rgba: FMRGBA

    public init(x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat, rgba: FMRGBA) {
        self.x = x
        self.y = y
        self.blur = blur
        self.spread = spread
        self.rgba = rgba
    }

    public var color: Color { rgba.platform.swiftUIColor }
}

/// 亮/暗成对的阴影 token。暗色下全部归零属于设计决定，不是缺失。
public struct FMShadowToken: Sendable {
    public let light: [FMShadowLayer]
    public let dark: [FMShadowLayer]

    public init(light: [FMShadowLayer], dark: [FMShadowLayer]) {
        self.light = light
        self.dark = dark
    }

    public func layers(for colorScheme: ColorScheme) -> [FMShadowLayer] {
        colorScheme == .dark ? dark : light
    }
}

/// 动效时长。三档是硬约束（见 docs/design-system.md「动效」），不要新增档位。
public struct FMDuration: Sendable, Hashable {
    public let milliseconds: Double

    public init(milliseconds: Double) {
        self.milliseconds = milliseconds
    }

    public var seconds: Double { milliseconds / 1000 }

    /// 平台开关 reduced-motion 时返回 0，调用方拿去喂 Animation 即可静默降级。
    @MainActor
    public var animation: Animation {
        Animation.timingCurve(0.22, 1, 0.36, 1, duration: FMAnimationPolicy.scale(seconds))
    }
}

/// 三次贝塞尔曲线，与 CSS 的 cubic-bezier(x1,y1,x2,y2) 一一对应。
public struct FMCurve: Sendable, Hashable {
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double

    public init(x1: Double, y1: Double, x2: Double, y2: Double) {
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
    }

    @MainActor
    public func animation(duration: FMDuration) -> Animation {
        Animation.timingCurve(x1, y1, x2, y2, duration: FMAnimationPolicy.scale(duration.seconds))
    }
}

// MARK: - Tokens

${colorSection}

${shapeStyleSection}

/// 圆角阶梯（基准 \`--radius\` = ${radiusBase}pt）。
/// 控件 10 / 卡片 14 / 弹窗 18 是常用三档，其余按倍数推导。
public enum FMRadius {
${radiusSection}
}

/// 两层阴影：贴边的 contact + 弥散的 ambient。亮色暖调，暗色归零。
public enum FMShadow {
${shadowSection}
}

/// 动效：时长三档 + 曲线三条。
public enum FMMotion {
${motionSection}
}

/// 玻璃材质参数（docs/liquid-glass-design.md）。原生端对应 .ultraThinMaterial + 这层 tint。
public enum FMGlass {
    /// \`--glass-blur\`：backdrop 模糊半径
    public static let blur: CGFloat = ${glassBlur}
    /// \`--glass-saturate\`：backdrop 饱和度
    public static let saturate: Double = ${glassSaturate}
}

extension UIColor {
    /// 让 FMRGBA.platform 在 iOS 侧也能直接变成 Color。
    fileprivate var swiftUIColor: Color { Color(self) }
}
`;

// macOS 侧需要同一份便利属性；用一个统一扩展处理，避免上面分支重复。
const normalized = swift.replace(
  `extension UIColor {
    /// 让 FMRGBA.platform 在 iOS 侧也能直接变成 Color。
    fileprivate var swiftUIColor: Color { Color(self) }
}`,
  `#if os(macOS)
extension NSColor {
    /// FMRGBA.platform → SwiftUI Color。
    fileprivate var swiftUIColor: Color { Color(nsColor: self) }
}
#else
extension UIColor {
    /// FMRGBA.platform → SwiftUI Color。
    fileprivate var swiftUIColor: Color { Color(self) }
}
#endif`,
);


/* ------------------------------------------------------------------ *
 * 6. 输出 Kotlin（Compose Multiplatform）
 *
 * Compose 同样没有 oklch，走的是同一套转换；颜色值必须与 Swift 侧逐位相同，
 * 否则 Android/Windows 与 macOS/iOS 的观感会漂。
 * ------------------------------------------------------------------ */

const ktColor = (c) => {
    const hex = [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    const alpha = Math.round(c.a * 255).toString(16).padStart(2, "0").toUpperCase();
    return `Color(0x${alpha}${hex})`;
};

const ktColorsBlock = (themeKey) => {
    const lines = [];
    for (const group of COLOR_GROUPS) {
        for (const prop of group.tokens) {
            const token = colorToken(prop);
            lines.push(`        ${camel(prop)} = ${ktColor(token[themeKey])},`);
        }
    }
    return lines.join("\n");
};

const ktRadius = (name) => {
  const factor = radiusMultipliers.get(name) ?? (name === "lg" ? 1 : undefined);
  if (factor === undefined) {
    throw new Error(`圆角阶梯里没有 --radius-${name}，检查 index.css 的 @theme 块`);
  }
  return `${Number((radiusBase * factor).toFixed(2))}.dp`;
};

const KT_COLOR_FIELDS = COLOR_GROUPS.flatMap((g) => g.tokens)
    .map((prop) => `    /** \`${prop}\` */\n    val ${camel(prop)}: Color,`)
    .join("\n");

const kotlin = `// 本文件由 scripts/apple/gen-theme.mjs 从 apps/web/src/index.css 生成，请勿手改。
// 重新生成：node scripts/apple/gen-theme.mjs（或 pnpm apple:theme）
//
// Compose 没有 oklch，颜色在生成期就转成 ARGB；同一份转换也用于 Swift 侧，
// 两端色值逐位相同。禁止在 Kotlin 里手写十六进制色值。

package dev.flaremo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Ember 配色的全部颜色 token，亮/暗各一份。 */
@Immutable
data class FlareMoColors(
${KT_COLOR_FIELDS}
)

val FlareMoLightColors = FlareMoColors(
${ktColorsBlock("light")}
)

val FlareMoDarkColors = FlareMoColors(
${ktColorsBlock("dark")}
)

/** 圆角阶梯（基准 ${radiusBase}dp）。控件/卡片/弹窗是常用三档。 */
@Immutable
data class FlareMoRadii(
    val sm: Dp = ${ktRadius("sm")},
    val md: Dp = ${ktRadius("md")},
    val lg: Dp = ${ktRadius("lg")},
    val xl: Dp = ${ktRadius("xl")},
    val xxl: Dp = ${ktRadius("2xl")},
    val xxxl: Dp = ${ktRadius("3xl")},
    val control: Dp = ${ktRadius("lg")},
    val card: Dp = ${ktRadius("xl")},
    val dialog: Dp = ${ktRadius("2xl")},
)

/** 动效时长三档（毫秒）与曲线。 */
@Immutable
data class FlareMoMotion(
    val feedbackMs: Int = ${ms(light.get("--duration-fast"))},
    val overlayMs: Int = ${ms(light.get("--duration-overlay"))},
    val surfaceMs: Int = ${ms(light.get("--duration-surface"))},
)

/** 全站排版阶梯，字号/行高（sp）与 Web 端 Type Scale 对齐。 */
@Immutable
data class FlareMoTypography(
    /** 统计大数 text-2xl */
    val display: TextStyle = TextStyle(fontSize = 24.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    /** 页面大标题 text-xl */
    val title: TextStyle = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
    /** 弹窗/区域标题 text-base */
    val headline: TextStyle = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    /** 卡片标题 */
    val cardTitle: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    /** 笔记正文 15sp / leading-7 */
    val body: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 28.sp),
    /** UI 说明 text-sm */
    val callout: TextStyle = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    /** 侧栏/导航项 13.5sp */
    val navigation: TextStyle = TextStyle(fontSize = 13.5.sp, lineHeight = 18.sp),
    /** 分组标签 text-xs */
    val label: TextStyle = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp),
    /** 辅助信息（硬下限 12sp，汉字再小会粘连） */
    val caption: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    /** 代码 */
    val monospace: TextStyle = TextStyle(fontSize = 13.sp, lineHeight = 20.sp),
)

private val LocalFlareMoColors = staticCompositionLocalOf { FlareMoLightColors }
private val LocalFlareMoRadii = staticCompositionLocalOf { FlareMoRadii() }
private val LocalFlareMoTypography = staticCompositionLocalOf { FlareMoTypography() }
private val LocalFlareMoMotion = staticCompositionLocalOf { FlareMoMotion() }

/** 全局主题入口：\`FlareMoTheme { ... }\` 包住整棵 UI 树。 */
@Composable
fun FlareMoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) FlareMoDarkColors else FlareMoLightColors
    CompositionLocalProvider(
        LocalFlareMoColors provides colors,
        LocalFlareMoRadii provides FlareMoRadii(),
        LocalFlareMoTypography provides FlareMoTypography(),
        LocalFlareMoMotion provides FlareMoMotion(),
    ) {
        // 把 token 映射进 Material3，让 M3 组件（TextField 等）也吃到同一套颜色。
        MaterialTheme(
            colorScheme = if (darkTheme) {
                darkColorScheme(
                    primary = colors.primary,
                    onPrimary = colors.primaryForeground,
                    background = colors.background,
                    onBackground = colors.foreground,
                    surface = colors.card,
                    onSurface = colors.cardForeground,
                    surfaceVariant = colors.muted,
                    onSurfaceVariant = colors.mutedForeground,
                    outline = colors.border,
                    error = colors.destructive,
                )
            } else {
                lightColorScheme(
                    primary = colors.primary,
                    onPrimary = colors.primaryForeground,
                    background = colors.background,
                    onBackground = colors.foreground,
                    surface = colors.card,
                    onSurface = colors.cardForeground,
                    surfaceVariant = colors.muted,
                    onSurfaceVariant = colors.mutedForeground,
                    outline = colors.border,
                    error = colors.destructive,
                )
            },
            content = content,
        )
    }
}

/** 取当前主题值的唯一入口。 */
object FlareMoTheme {
    val colors: FlareMoColors
        @Composable @ReadOnlyComposable get() = LocalFlareMoColors.current

    val radii: FlareMoRadii
        @Composable @ReadOnlyComposable get() = LocalFlareMoRadii.current

    val typography: FlareMoTypography
        @Composable @ReadOnlyComposable get() = LocalFlareMoTypography.current

    val motion: FlareMoMotion
        @Composable @ReadOnlyComposable get() = LocalFlareMoMotion.current
}
`;

if (process.argv.includes("--check")) {
  if (!existsSync(OUT_PATH)) {
    console.error(`✗ 缺少生成物：${OUT_PATH}`);
    process.exit(1);
  }
  const current = readFileSync(OUT_PATH, "utf8");
  if (current !== normalized) {
    console.error(
      "✗ Theme.swift 与 index.css 不一致，跑 node scripts/apple/gen-theme.mjs 重新生成",
    );
    process.exit(1);
  }
  if (existsSync(KT_OUT_PATH)) {
    if (readFileSync(KT_OUT_PATH, "utf8") !== kotlin) {
      console.error(
        "✗ Theme.kt 与 index.css 不一致，跑 node scripts/apple/gen-theme.mjs 重新生成",
      );
      process.exit(1);
    }
    console.log("✓ Theme.swift 与 Theme.kt 都是最新的");
  } else {
    console.log("✓ Theme.swift 是最新的（Theme.kt 还没生成：Kotlin 工程未建）");
  }
  process.exit(0);
}

writeFileSync(OUT_PATH, normalized, "utf8");
console.log(
  `✓ 已生成 ${OUT_PATH.replace(`${REPO}/`, "")} (${normalized.length} 字节)`,
);

// Kotlin 工程还没建时（目录不存在）只提示不报错——生成器要能在骨架之前跑。
const ktDirectory = dirname(KT_OUT_PATH);
if (existsSync(ktDirectory)) {
  writeFileSync(KT_OUT_PATH, kotlin, "utf8");
  console.log(
    `✓ 已生成 ${KT_OUT_PATH.replace(`${REPO}/`, "")} (${kotlin.length} 字节)`,
  );
} else {
  console.log(`· 跳过 Theme.kt：${ktDirectory.replace(`${REPO}/`, "")} 还不存在`);
}
