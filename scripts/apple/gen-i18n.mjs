#!/usr/bin/env node
/**
 * 文案生成器：apps/web/src/i18n/messages/*.ts → FlareMoDesign/Generated/Localized.swift
 *
 * 为什么生成而不是手抄：文案事实源在 Web 端（docs/native-clients.md §7.3），8 个语言
 * 各一份 TS 目录，手抄必然漂。v1 只生成 zh-Hans 与 en-US 两份文案；其余 6 种语言仍会
 * 被解析和校验（key 集合、插值占位符必须与 zh-CN 完全一致），补语言时把 LOCALES 里
 * 的 emitted 开关改成 true 即可。
 *
 * 怎么解析 TS：Node 不能直接 import .ts。这里复用根 devDependencies 里已有的 esbuild
 * （scripts/startup-graph.mjs 同款用法）把 TS 转成 ESM——只剥类型、不打包——再用
 * data: URL import 求值。相比正则，拿到的是 JS 真实字符串（\u 转义、引号、换行都已
 * 解开），文案怎么排版都不会静默漏 key；解析失败会直接报错，不会生成半份文件。
 *
 * 用法：
 *   node scripts/apple/gen-i18n.mjs            # 生成（幂等：排序稳定，重复跑输出相同）
 *   node scripts/apple/gen-i18n.mjs --check    # 只校验生成物是否最新（CI/门禁用）
 *
 * 相关文档：docs/native-clients.md §7.3、docs/design-system.md（文案风格约定）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const MESSAGES_DIR = resolve(REPO, "apps/web/src/i18n/messages");
const OUT_PATH = resolve(
  REPO,
  "packages/apple/FlareMoKit/Sources/FlareMoDesign/Generated/Localized.swift",
);

// esbuild 是根 package.json 的 devDependencies，不是这个脚本新增的依赖。
// 从脚本自身位置解析（同 scripts/startup-graph.mjs），避免写死 pnpm store 路径。
const esbuild = createRequire(import.meta.url)("esbuild");

/* ------------------------------------------------------------------ *
 * 1. 语言清单与命名规则
 * ------------------------------------------------------------------ */

/**
 * 8 个语言的事实源。emitted=true 的才生成 Swift 常量，其余只做一致性校验：
 * v1 只做 zh-Hans + en-US（§7.3），ja/fr/es/ko/ru/ar 放 P2。
 */
const LOCALES = [
  { tag: "zh-Hans", file: "zh-CN", exportName: "zhCN", emitted: true },
  { tag: "en-US", file: "en-US", exportName: "enUS", emitted: true },
  { tag: "ja", file: "ja", exportName: "ja", emitted: false },
  { tag: "fr", file: "fr", exportName: "fr", emitted: false },
  { tag: "es", file: "es", exportName: "es", emitted: false },
  { tag: "ko", file: "ko", exportName: "ko", emitted: false },
  { tag: "ru", file: "ru", exportName: "ru", emitted: false },
  { tag: "ar", file: "ar", exportName: "ar", emitted: false },
];

/** 主目录：key 集合与插值占位符都以它为准（对应 Web 的 TranslationKey）。 */
const MASTER_TAG = "zh-Hans";

/** key 的形状：至少两段点号路径，每段是标识符（与 Web 的 key.ts / usage.test.ts 一致）。 */
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Web 端插值语法是 {name}（见 apps/web/src/i18n.tsx 的 interpolate）。 */
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

/**
 * Swift 保留字（含上下文关键字）。命中的标识符一律加反引号，生成物里能直接写
 * `L10n.Common.import` 这种访问。故意放宽：多包一层反引号永远合法，漏包就会语法错误。
 */
const SWIFT_KEYWORDS = new Set([
  "Any",
  "Self",
  "actor",
  "any",
  "as",
  "associatedtype",
  "async",
  "await",
  "borrowing",
  "break",
  "case",
  "catch",
  "class",
  "consuming",
  "continue",
  "convenience",
  "copy",
  "default",
  "defer",
  "deinit",
  "didSet",
  "do",
  "dynamic",
  "each",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "final",
  "for",
  "func",
  "get",
  "guard",
  "if",
  "import",
  "in",
  "indirect",
  "infix",
  "init",
  "inout",
  "internal",
  "is",
  "isolated",
  "lazy",
  "let",
  "macro",
  "mutating",
  "nil",
  "nonisolated",
  "nonmutating",
  "open",
  "operator",
  "optional",
  "override",
  "package",
  "postfix",
  "precedencegroup",
  "prefix",
  "private",
  "protocol",
  "public",
  "repeat",
  "required",
  "rethrows",
  "return",
  "self",
  "sending",
  "some",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "typealias",
  "unowned",
  "var",
  "weak",
  "where",
  "while",
  "willSet",
]);

/**
 * 生成器自己占用的类型名。key 首段恰好撞上时直接报错，而不是悄悄改名——
 * 命名规则必须可预测（见生成文件头）。
 */
const RESERVED_TYPE_NAMES = new Set(["SupportedLanguage", "L10n"]);

/** key 首段 → 嵌套 enum 名（首字母大写）。 */
const upperFirst = (segment) => segment[0].toUpperCase() + segment.slice(1);

/** key 的其余段 → 属性名（第二段原样，后续段首字母大写），与生成文件头的规则一致。 */
const swiftPathOf = (key) => {
  const [head, ...rest] = key.split(".");
  return {
    group: upperFirst(head),
    member: rest
      .map((segment, index) => (index === 0 ? segment : upperFirst(segment)))
      .join(""),
  };
};

const swiftIdentifier = (name) =>
  SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;

/* ------------------------------------------------------------------ *
 * 2. 读取 TS 文案：esbuild 剥类型 → data: URL import
 * ------------------------------------------------------------------ */

async function loadCatalog(locale) {
  const source = readFileSync(
    resolve(MESSAGES_DIR, `${locale.file}.ts`),
    "utf8",
  );
  // format: esm 保留 export；loader: ts 只剥类型、不改语义。文案文件是纯对象导出，
  // 没有 import，所以 transform 的结果可以直接求值，不涉及打包。
  const { code } = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
    target: "esnext",
  });
  const encoded = Buffer.from(code).toString("base64");
  const module = await import(`data:text/javascript;base64,${encoded}`);
  const catalog = module[locale.exportName];
  if (
    catalog === null ||
    typeof catalog !== "object" ||
    Array.isArray(catalog)
  ) {
    throw new Error(
      `${locale.tag}: ${locale.file}.ts 没有导出对象 ${locale.exportName}`,
    );
  }
  return catalog;
}

function validateCatalog(locale, catalog) {
  for (const [key, value] of Object.entries(catalog)) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`${locale.tag}: key 不是「点号路径」形状：${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`${locale.tag}: ${key} 的值不是字符串`);
    }
    if (value.length === 0) {
      throw new Error(`${locale.tag}: ${key} 的值是空字符串`);
    }
  }
}

const formatList = (items) =>
  items.length === 0
    ? "无"
    : `${items.slice(0, 5).join(", ")}${items.length > 5 ? ` 等 ${items.length} 个` : ""}`;

/** 8 个语言的 key 集合必须完全一致（与 Web 的 parity.test.ts 同一个不变量）。 */
function assertKeyParity(master, catalogs) {
  const masterKeys = Object.keys(master.catalog).sort();
  for (const locale of catalogs) {
    if (locale.tag === MASTER_TAG) continue;
    const missing = masterKeys.filter((key) => !(key in locale.catalog));
    const extra = Object.keys(locale.catalog).filter(
      (key) => !(key in master.catalog),
    );
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `${locale.tag} 与 ${MASTER_TAG} 的 key 不一致：缺少 ${formatList(missing)}；多出 ${formatList(extra)}`,
      );
    }
  }
  return masterKeys;
}

/**
 * 取出模板里的插值占位符（按首次出现排序、去重）。
 * 顺手校验没有孤立的 { 或 } —— 花括号拼错会让调用方的参数被悄悄丢弃（Web 端同样如此）。
 */
function placeholdersOf(tag, key, template) {
  const names = [];
  let literal = "";
  let lastIndex = 0;
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    literal += template.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const name = match[1];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `${tag}: ${key} 的占位符 {${name}} 不是合法的 Swift 参数名`,
      );
    }
    if (!names.includes(name)) names.push(name);
  }
  literal += template.slice(lastIndex);
  if (/[{}]/.test(literal)) {
    throw new Error(`${tag}: ${key} 里有无法解析的花括号：${template}`);
  }
  return names;
}

/** 插值占位符集合也要跨语言一致：翻译漏写 {name} 时 Web 端会静默丢参数，这里拦住。 */
function assertPlaceholderParity(key, masterNames, locale, template) {
  const names = placeholdersOf(locale.tag, key, template);
  const sameSet =
    names.length === masterNames.length &&
    names.every((name) => masterNames.includes(name));
  if (!sameSet) {
    throw new Error(
      `${locale.tag}: ${key} 的插值占位符与 ${MASTER_TAG} 不一致：${formatList(names)} vs ${formatList(masterNames)}`,
    );
  }
}

/** 一个 Swift 标识符只能承载一个 key：分组名、属性名两条路径都查重，冲突就报错。 */
function assertNoIdentifierCollisions(rows) {
  const groups = new Map();
  const members = new Map();
  for (const row of rows) {
    const firstSegment = row.key.split(".")[0];
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(row.group)) {
      throw new Error(
        `${row.key}: 分组名 ${row.group} 不是合法的 Swift 类型名`,
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.member)) {
      throw new Error(
        `${row.key}: 属性名 ${row.member} 不是合法的 Swift 标识符`,
      );
    }
    if (RESERVED_TYPE_NAMES.has(row.group)) {
      throw new Error(`${row.key}: 分组名 ${row.group} 与生成器保留类型名冲突`);
    }
    const previousGroup = groups.get(row.group);
    if (previousGroup !== undefined && previousGroup !== firstSegment) {
      throw new Error(
        `分组名冲突：${previousGroup} 与 ${firstSegment} 都映射到 L10n.${row.group}`,
      );
    }
    groups.set(row.group, firstSegment);

    const identifier = `${row.group}.${row.member}`;
    const previousKey = members.get(identifier);
    if (previousKey !== undefined) {
      throw new Error(
        `标识符冲突：${previousKey} 与 ${row.key} 都映射到 L10n.${identifier}`,
      );
    }
    members.set(identifier, row.key);
  }
}

/* ------------------------------------------------------------------ *
 * 3. 生成 Swift 源码
 * ------------------------------------------------------------------ */

/** 按 key 分组：组名排序、组内按 key 字典序，保证重复生成的内容完全一致。 */
function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.group) ?? [];
    list.push(row);
    groups.set(row.group, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, list]) => [
      name,
      list.sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      ),
    ]);
}

const SWIFT_ESCAPES = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
};

/** 转义 Swift 双引号字面量的一整段内容（不带两侧引号；中文/emoji 原样保留）。 */
function escapedSwiftContent(text) {
  let out = "";
  for (const char of text) {
    if (char in SWIFT_ESCAPES) {
      out += SWIFT_ESCAPES[char];
      continue;
    }
    const codePoint = char.codePointAt(0);
    out +=
      codePoint < 0x20 || codePoint === 0x7f
        ? `\\u{${codePoint.toString(16).toUpperCase()}}`
        : char;
  }
  return out;
}

const swiftStringLiteral = (text) => `"${escapedSwiftContent(text)}"`;

/**
 * 把 {name} 模板写成 Swift 插值字面量："共 {count} 条" → "共 \(count) 条"。
 * 插值必须落在同一个字符串字面量内部，所以这里自己拼引号，不能复用 swiftStringLiteral。
 */
function swiftInterpolatedLiteral(template) {
  let body = "";
  let lastIndex = 0;
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    body += escapedSwiftContent(template.slice(lastIndex, match.index));
    body += `\\(${swiftIdentifier(match[1])})`;
    lastIndex = match.index + match[0].length;
  }
  body += escapedSwiftContent(template.slice(lastIndex));
  return `"${body}"`;
}

function renderMember(row, emitted) {
  const doc = `        /// \`${row.key}\``;
  const member = swiftIdentifier(row.member);
  if (row.names.length === 0) {
    const values = emitted.map((locale) =>
      swiftStringLiteral(locale.catalog[row.key]),
    );
    return [
      doc,
      `        public static var ${member}: String { fmPick(${values.join(", ")}) }`,
    ].join("\n");
  }
  const parameters = row.names
    .map((name) => `${swiftIdentifier(name)}: String`)
    .join(", ");
  // 每种语言用自己的模板插值：占位符顺序在翻译之间可以不同，参数按名字传。
  const values = emitted.map((locale) =>
    swiftInterpolatedLiteral(locale.catalog[row.key]),
  );
  return [
    doc,
    `        public static func ${member}(${parameters}) -> String {`,
    `            fmPick(${values.join(", ")})`,
    "        }",
  ].join("\n");
}

function renderGroup(name, rows, emitted) {
  const prefix = rows[0].key.split(".")[0];
  const lines = [
    `    /// \`${prefix}.*\`：${rows.length} 条文案。`,
    "    @MainActor",
    `    public enum ${name} {`,
  ];
  rows.forEach((row, index) => {
    if (index > 0) lines.push("");
    lines.push(renderMember(row, emitted));
  });
  lines.push("    }");
  return lines.join("\n");
}

function renderSwift({ rows, keyCount, catalogs }) {
  const emitted = catalogs.filter((locale) => locale.emitted);
  const groups = groupRows(rows);
  const functionCount = rows.filter((row) => row.names.length > 0).length;
  const localeSummary = catalogs
    .map(
      (locale) =>
        `${locale.tag}(${Object.keys(locale.catalog).length}${locale.emitted ? "" : "，仅校验"})`,
    )
    .join("、");

  const header = [
    "// 本文件由 scripts/apple/gen-i18n.mjs 生成，请勿手改。",
    "// 重新生成：node scripts/apple/gen-i18n.mjs（--check 只校验是否最新）",
    "//",
    "// 文案事实源：apps/web/src/i18n/messages/*.ts（8 个语言，zh-CN 是主目录）。",
    "// v1 只生成 zh-Hans 与 en-US；ja/fr/es/ko/ru/ar 仍参与解析和 key 校验，但不生成常量",
    "// （docs/native-clients.md §7.3，补齐语言的成本只是改生成脚本里的一行开关）。",
    "//",
    "// 命名规则（脚本里是同一套规则，改这里必须同步改 scripts/apple/gen-i18n.mjs）：",
    "//   key 的点号路径 → 嵌套 enum + 属性：首段 PascalCase 成 enum 名，其余段拼接成属性名",
    "//   （第二段原样、后续段首字母大写）：",
    "//     nav.articles                → L10n.Nav.articles",
    "//     connect.clientType.device   → L10n.Connect.clientTypeDevice",
    "//   Swift 保留字加反引号：",
    "//     common.import               → L10n.Common.`import`",
    "//   带 {name} 插值的文案生成 func，参数一律 String（数字、日期由调用方按语言格式化）：",
    '//     connect.lastUsed            → L10n.Connect.lastUsed(date: "3 月 4 日")',
    "//",
    "// 为什么不用 .xcstrings：SwiftPM 对 String Catalog 的资源打包支持不稳（尤其跨平台",
    "// target），生成常量没有资源查找、key 拼错是编译错误。文案只在 UI 层（MainActor）使用，",
    "// 所以本文件显式 @MainActor，不依赖 target 的默认隔离设置。",
    "//",
    `// 本次生成：${keyCount} 条文案 / ${groups.length} 个组 / ${functionCount} 个带插值的 func。`,
    `// 参与校验的语言：${localeSummary}。`,
  ].join("\n");

  const preamble = [
    "import Foundation",
    "",
    "/// 本地化文案入口。所有文案都在编译期确定：key 拼错是编译错误，不做运行时字符串查找，",
    "/// 也不依赖 SPM 资源打包。事实源与生成规则见本文件头部。",
    "public enum L10n {",
    "    /// 生成时支持的语言（docs/native-clients.md §7.3：v1 只有简体中文与英文）。",
    "    public enum SupportedLanguage: String, CaseIterable, Sendable, Hashable {",
    '        case zhHans = "zh-Hans"',
    '        case enUS = "en-US"',
    "",
    "        /// 按系统首选语言解析：简体中文（含其它 zh 变体）→ zh-Hans，其余 → en-US。",
    "        public static var system: SupportedLanguage { resolved(from: Locale.current) }",
    "",
    "        /// 纯函数形式：方便单测，也方便 App 按自己的偏好解析后赋给 `L10n.language`。",
    "        public static func resolved(from locale: Locale) -> SupportedLanguage {",
    '            locale.language.languageCode?.identifier == "zh" ? .zhHans : .enUS',
    "        }",
    "    }",
    "",
    "    /// 当前生效语言，默认跟随系统。",
    "    ///",
    "    /// App 若要支持「应用内切换语言」，在创建界面之前赋值一次即可；切换后需要重建视图树",
    "    /// 才会生效（这里只负责取值，不负责通知刷新）。该属性 @MainActor，可变状态因此安全。",
    "    @MainActor",
    "    public static var language: SupportedLanguage = .system",
    "",
    "    // MARK: - 文案组",
  ].join("\n");

  const fmPick = [
    "/// 生成物内部的语言选择器：参数顺序固定为 zh-Hans、en-US（即 LOCALES 里 emitted 的顺序）。",
    "/// 要加第三种语言时，把它换成 switch 或参数表，不要在末尾直接追加参数。",
    "@MainActor",
    "private func fmPick(_ zhHans: String, _ enUS: String) -> String {",
    "    switch L10n.language {",
    "    case .zhHans: zhHans",
    "    case .enUS: enUS",
    "    }",
    "}",
  ].join("\n");

  // 先拼所有组，再用空行分隔；`}` 收掉 public enum L10n。
  const body = groups
    .map(([name, rows]) => renderGroup(name, rows, emitted))
    .join("\n\n");

  return `${[header, "", preamble, "", body, "}", "", fmPick].join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * 4. 入口
 * ------------------------------------------------------------------ */

const catalogs = [];
for (const locale of LOCALES) {
  catalogs.push({ ...locale, catalog: await loadCatalog(locale) });
}

const master = catalogs.find((locale) => locale.tag === MASTER_TAG);
if (master === undefined) throw new Error(`LOCALES 里缺少主目录 ${MASTER_TAG}`);

for (const locale of catalogs) validateCatalog(locale, locale.catalog);
const keys = assertKeyParity(master, catalogs);

const rows = keys.map((key) => {
  const names = placeholdersOf(MASTER_TAG, key, master.catalog[key]);
  for (const locale of catalogs) {
    if (locale.tag === MASTER_TAG) continue;
    assertPlaceholderParity(key, names, locale, locale.catalog[key]);
  }
  return { key, names, ...swiftPathOf(key) };
});

assertNoIdentifierCollisions(rows);

if (catalogs.filter((locale) => locale.emitted).length !== 2) {
  throw new Error(
    "fmPick 目前只支持两种生成语言；扩语言时要同步改 renderSwift",
  );
}

const output = renderSwift({ rows, keyCount: keys.length, catalogs });

if (process.argv.includes("--check")) {
  if (!existsSync(OUT_PATH)) {
    console.error(`✗ 缺少生成物：${relative(REPO, OUT_PATH)}`);
    process.exit(1);
  }
  const current = readFileSync(OUT_PATH, "utf8");
  if (current !== output) {
    console.error(
      `✗ ${relative(REPO, OUT_PATH)} 不是最新，请运行 node scripts/apple/gen-i18n.mjs`,
    );
    process.exit(1);
  }
  console.log(
    `✓ ${relative(REPO, OUT_PATH)} 已是最新（${keys.length} 条文案）`,
  );
} else {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, output);
  const bytes = Buffer.byteLength(output);
  const functionCount = rows.filter((row) => row.names.length > 0).length;
  console.log(
    `✓ 生成 ${relative(REPO, OUT_PATH)}：${keys.length} 条文案 / ${groupRows(rows).length} 个组 / ${functionCount} 个插值 func / ${bytes} 字节`,
  );
}
