#!/usr/bin/env node
/**
 * `pnpm plugin:new <id> [--kind document|sandbox] [--tier community|official]`
 *
 * Scaffold a plugin folder under `plugins/<tier>/<id>/` with a manifest, one
 * card, a README and a source note. Generated cards are intentionally plain —
 * they pass `pnpm plugin:check` as-is, so authors start from a green baseline.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

class CliError extends Error {}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=");
      const value = inline ?? argv[index + 1] ?? "";
      if (inline === undefined) index += 1;
      if (name) flags.set(name, value);
      continue;
    }
    positional.push(arg);
  }
  return { flags, positional };
}

function documentCard(_id: string) {
  return {
    specVersion: 1,
    root: {
      type: "column",
      style: {
        height: "100%",
        padding: 28,
        background: "#ffffff",
        color: "#262626",
      },
      children: [
        {
          // Labels are localized text: keep them at 12px or above and leave
          // letterSpacing/uppercase off by default. Han glyphs smear below
          // 12px, and tracking tuned for Latin reads loose on Han.
          type: "text",
          text: {
            "zh-CN": "我的卡片",
            "en-US": "My card",
          },
          style: {
            font: { size: 12, color: "brand.500" },
          },
        },
        {
          type: "text",
          text: "{body}",
          style: {
            flex: 1,
            marginTop: 20,
            clamp: 10,
            overflow: "hidden",
            font: { size: 15, lineHeight: 1.8 },
          },
        },
        {
          type: "row",
          style: { justify: "space-between", align: "end" },
          children: [
            {
              type: "text",
              text: "{brand.product} · {date}",
              style: { font: { size: 12, color: "#a3a3a3" } },
            },
            {
              type: "text",
              text: "{stats}",
              style: { font: { size: 12, color: "#a3a3a3" } },
            },
          ],
        },
      ],
    },
  };
}

function sandboxEntry(title: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  /* The card must render its own full canvas: the host sizes the iframe to
     the size declared in plugin.json and captures .__flaremoCaptureTarget. */
  #card {
    width: 340px;
    height: 420px;
    box-sizing: border-box;
    background: #ffffff;
    color: #262626;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    /* system-ui already resolves CJK per script from the lang the host
       stamps on this frame; naming a Han face here would override it. */
    font-family: system-ui, -apple-system, sans-serif;
  }
  .label {
    /* Author-replaceable label: 12px floor and no tracking/uppercase, so it
       stays legible once it holds Han text. */
    font-size: 12px;
    color: var(--accent, #ff6a00);
  }
  .body { flex: 1; font-size: 15px; line-height: 1.8; white-space: pre-wrap; overflow: hidden; }
  .foot { display: flex; justify-content: space-between; font-size: 12px; color: #a3a3a3; }
</style>
</head>
<body>
<div id="card">
  <div class="label">${title}</div>
  <div class="body" id="body"></div>
  <div class="foot">
    <span id="brand"></span>
    <span id="date"></span>
  </div>
</div>
<script>
  // The host declares this element as the capture target; everything inside it
  // (including canvases) is serialized to the exported PNG.
  window.__flaremoCaptureTarget = document.getElementById("card");

  // The host calls this on init and whenever the payload changes.
  window.__flaremoOnUpdate = function (payload) {
    var data = (payload && payload.data) || {};
    var options = (payload && payload.options) || {};
    document.getElementById("body").textContent = data.body || "";
    document.getElementById("brand").textContent = (data.brand || {}).product || "";
    document.getElementById("date").textContent = data.date || "";
    if (options.accent) {
      document.getElementById("card").style.setProperty("--accent", options.accent);
    }
  };
</script>
</body>
</html>
`;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const id = positional[0];
  if (!id || !ID_PATTERN.test(id)) {
    throw new CliError(
      "usage: pnpm plugin:new <id> [--kind document|sandbox] [--tier community|official]",
    );
  }
  const kind = flags.get("kind") ?? "document";
  if (kind !== "document" && kind !== "sandbox") {
    throw new CliError('--kind must be "document" or "sandbox"');
  }
  const tier = flags.get("tier") ?? "community";
  if (tier !== "official" && tier !== "community") {
    throw new CliError('--tier must be "official" or "community"');
  }
  const cardId = id.replace(/-pack$/, "");
  const name = cardId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const dir = path.join(repoRoot, "plugins", tier, id);
  const manifest = {
    specVersion: 1,
    id,
    version: "0.1.0",
    name: { "zh-CN": name, "en-US": name },
    description: {
      "zh-CN": "请替换为这张卡片的说明。",
      "en-US": "Replace this with a short description of the card.",
    },
    author: { name: "Your name" },
    license: "AGPL-3.0-only",
    defaultEnabled: tier === "official",
    contributes: {
      shareCardTemplates: [
        {
          id: cardId,
          kind,
          name: { "zh-CN": name, "en-US": name },
          ...(kind === "document"
            ? { document: `cards/${cardId}.json` }
            : {
                entry: `cards/${cardId}/index.html`,
                options: [
                  {
                    key: "accent",
                    type: "color",
                    label: { "zh-CN": "点缀色", "en-US": "Accent color" },
                    default: "#ff6a00",
                  },
                ],
              }),
        },
      ],
    },
  };

  await mkdir(path.join(dir, "cards"), { recursive: true });
  await writeFile(
    path.join(dir, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (kind === "document") {
    await writeFile(
      path.join(dir, "cards", `${cardId}.json`),
      `${JSON.stringify(documentCard(cardId), null, 2)}\n`,
    );
  } else {
    await mkdir(path.join(dir, "cards", cardId), { recursive: true });
    await writeFile(
      path.join(dir, "cards", cardId, "index.html"),
      sandboxEntry(name),
    );
  }
  await writeFile(path.join(dir, "README.md"), readme(id, kind, tier));

  console.log("");
  console.log(
    `${GREEN}✓${RESET} Created plugins/${tier}/${id} (${kind} card "${cardId}")`,
  );
  console.log("");
  console.log(`${DIM}Next steps${RESET}`);
  console.log(`  1. pnpm plugin:check plugins/${tier}/${id}`);
  console.log(`  2. pnpm dev  → open the share-image dialog to preview`);
  console.log(
    `  3. pnpm plugins:build  → regenerate registry.json + store artifacts`,
  );
  console.log("");
}

function readme(id: string, kind: string, tier: string) {
  const install =
    tier === "community"
      ? `Community plugins are off by default on every instance: an owner installs
this plugin from the store (or uploads the zip) and enables it explicitly.`
      : `Official plugins ship with the app and are enabled by default.`;
  return `# ${id}

A FlareMo plugin contributing a **${kind}** share-card template.

## Layout

\`\`\`
plugin.json        manifest (id, version, name, contributes)
cards/             card payloads (${
    kind === "document"
      ? "one JSON document per card"
      : "one self-contained HTML entry per card"
  })
\`\`\`

## Develop

\`\`\`bash
pnpm plugin:check plugins/${tier}/${id}   # validate with the instance's own rules
pnpm dev                                  # preview in the share dialog
\`\`\`

## Install

${install}

## Publishing

\`\`\`bash
pnpm plugins:build                        # zip + sha256 + registry.json
\`\`\`

Then commit the folder (and \`plugins/registry.json\`) in a PR. See
\`plugins/README.md\` for the full contribution guide.
`;
}

try {
  await main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`${RED}plugin:new failed — ${error.message}${RESET}`);
    process.exit(1);
  }
  throw error;
}
