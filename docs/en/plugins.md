# Plugins

FlareMo extends through **slots**. A plugin is a folder — a manifest plus the files it references. Adding one never touches core code: the app discovers plugins at build time and admins choose what to enable.

The platform currently ships one slot: **`shareCardTemplates`** — the cards available when sharing a note as an image. The machinery (packages, validation, store, sandbox) is slot-independent; more slots arrive through spec versions.

## For instances (admins)

### Bundled and official cards

Four official cards ship out of the box — **Plain**, **Daily**, **Ticket**, **Postcard** — plus a **Postmark** demo that draws itself with canvas. Official cards are enabled by default, so everyone can use them right away.

### Install from the store

**Account settings → Plugins → Plugin store**:

1. **Browse** — every plugin in every configured directory: name, author, tier, card thumbnails, size.
2. **Install** — download → SHA-256 verification → unpack → store in this instance's R2. The default source is `https://flaremo.app/plugins/registry.json`.
3. **Enable** — **installing is not enabling**: community/store plugins arrive switched off. Only after you turn one on does its card appear to users.
4. **Update** — when a directory lists a newer version the row shows "Update to vX"; installs are pinned, never silent.
5. **Uninstall** — removes the plugin's assets and records from this instance.

### Upload your own package

The same panel's **Upload package** takes a zip. An uploaded plugin exists **only on your instance** and is never sent anywhere — ideal for internal cards, client work, or experiments not yet proposed to the directory.

### Curate the picker

Below the plugin list, manage cards: **move up/down** to order them, the **star** to set the default selection, the **eye** to hide a card from users. Cards with options (like the Postmark's accent color) are tuned inline.

### Custom directories

An instance can add extra directory sources (same registry format, https required). The official directory is just the default source — anywhere that can host a `registry.json` can be a directory.

### Privacy and security

Plugin cards run in an **opaque-origin sandbox iframe** under a strict CSP: **they have no network access at all**. The only data a card receives is the current note's text, date, stats, and the instance's branding — the floor that keeps "share a card" from ever becoming an exfiltration channel.

---

## For authors

The full guide lives in [plugins/README.md](https://github.com/realchendahuang/FlareMo/blob/main/plugins/README.md). The short path:

```bash
pnpm plugin:new my-pack                  # scaffold plugins/community/my-pack
pnpm plugin:check plugins/community/my-pack
pnpm dev                                  # live preview in the share dialog
pnpm plugins:build                        # zip + sha256 + registry.json
```

### Two card flavors

| | **document** | **sandbox** |
| --- | --- | --- |
| Payload | a JSON layout document | self-contained HTML (plain HTML/CSS/JS) |
| Renders | in-app, by the document renderer | freely, inside an opaque-origin iframe |
| Power | layout, text, images, inline SVG, gradients, theme tokens | anything, canvas included |
| Best for | most cards, non-developers | special effects (drawing, filters, unusual type) |

Full node/style reference: [plugins/README.md](https://github.com/realchendahuang/FlareMo/blob/main/plugins/README.md#document-cards-json). The [Postcard card](https://github.com/realchendahuang/FlareMo/blob/main/plugins/official/flaremo-cards/cards/postcard.json) is a working example of SVG watercolor in a document card.

### The one hard rule

**No network, self-contained.** That is privacy, not a limit on expressiveness: a card renders the user's private note, so a template that could reach the network could leak it. External scripts, `@import`, remote images, and absolute paths are all rejected by `plugin:check`.

### Validate and publish

`pnpm plugin:check` runs the **exact rules instances enforce on install** — you will never see "passed locally, rejected on install". It covers manifests, document nodes, color tokens, bindings, the SVG whitelist, sandbox self-containment, previews, and size limits, with actionable hints on every error.

To propose a plugin for the official directory: add the folder under `plugins/community/<id>/`, run `pnpm plugin:check` and `pnpm plugins:build`, and open a PR including the regenerated `registry.json`. Inclusion is not endorsement: community plugins install disabled on every instance.

### Brand cards

A brand can ship its cards as a community pack ([`plugins/community/kosx-pack`](https://github.com/realchendahuang/FlareMo/tree/main/plugins/community/kosx-pack) is the working example). The convention: declare the author and the brand in the manifest, and keep `defaultEnabled: false` — no instance's users ever see it unless that instance's admin turns it on.

---

## Standard and implementation

- Full standard: [`docs/plugin-platform-standard.md`](../plugin-platform-standard.md) (slot model, trust tiers, store protocol, roadmap).
- Contribution guide: [`plugins/README.md`](https://github.com/realchendahuang/FlareMo/blob/main/plugins/README.md).
- Official directory: [`https://flaremo.app/plugins/registry.json`](https://flaremo.app/plugins/registry.json).
