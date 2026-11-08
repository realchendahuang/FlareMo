# FlareMo 原生客户端技术方案（macOS / Android / iOS / Windows）

> 状态：**方案稿，待排期实施**（技术方向 2026-11-08 拍板）
> 决策来源：用户决定「四端都做原生，macOS 先做，然后 Android，再 iOS」，Windows 用 Kotlin/Compose 复用 Android，不做 WebView 壳。
> 关联文档：[tech-stack.md](./tech-stack.md)（Web/Worker 栈）、[agent-access-design.md](./agent-access-design.md)（客户端接入层）、[design-system.md](./design-system.md)（Ember 设计系统）、[ROADMAP.md](../ROADMAP.md)。
> 本文事实均核实到 2026-11-08；标注「未找到可靠来源」处不要当结论用。

---

## 0. 一句话方案

**两套原生代码库，不是四套。** Apple 栈（Swift + SwiftUI）先出 macOS、iOS 复用；Kotlin 栈（Compose Multiplatform）先出 Android、Windows 复用。两栈之间共享三件东西——**接口契约、本地数据语义、设计 token**。

| 平台 | 顺序 | 语言 / UI | 关键库 | 复用来源 |
| --- | --- | --- | --- | --- |
| macOS | ① | Swift 6 / SwiftUI + AppKit | GRDB、swift-openapi-generator、Sparkle | 新建 `FlareMoKit` |
| Android | ② | Kotlin / Compose | Ktor、Room 3、Koin | 新建 `flaremo-core`（KMP） |
| iOS | ③ | Swift / SwiftUI（同一 Multiplatform target） | 同 macOS + Share Extension、App Intents、WidgetKit | macOS 的 60–70% |
| Windows | ④ | Kotlin / Compose Desktop（JVM） | 同 Android + Nucleus（桌面集成） | Android 的 70–80% |

**每端只做核心 5 屏**：速记、时间线、搜索、回顾、设置（含连接实例）。**Web 端继续是完整客户端**，原生端是「系统入口 + 高频读写」，不做功能对齐。

---

## 1. 决策与边界

### 1.1 已定

- **D1 原生优先**：不用 WebView 壳、不用 Electron/Tauri 装 Web 版。
- **D2 不用 React Native**：RN 覆盖不了 macOS/Windows（rn-macos 0.83 / rn-windows 0.85 自成版本线，落后主线 3–5 个 minor），且最复杂的一屏（编辑器）在 RN 里仍是 WebView，拿不到「原生流畅」。
- **D3 两栈而不是四栈**：Swift（Apple 两端共享）+ Kotlin（Android 与 Windows 共享）。
- **D4 顺序**：macOS → Android → iOS → Windows。macOS 先做，因为迭代最快（无模拟器/审核），且能变成日常自用工具；iOS 最后，直接吃 macOS 的成果。
- **D5 不做 parity**：5 屏、zh/en 双语起步；WYSIWYG、插件、团队、admin 不进原生端。
- **D6 单向事实源**：`packages/contracts`（接口）与 `apps/web/src/index.css`（设计 token）是唯一事实源，原生端只消费、不反写。
- **D7 许可证白名单**：新依赖只允许 MIT / Apache-2.0 / BSD / OFL。GPL 系一律不进（见 §5.10 的 STTextView 坑）。
- **D8 原生端必须能连任意自托管实例**：登录页填实例域名，认证走设备授权（RFC 8628 配对码），不用 cookie session。
- **D9 附件走 R2 的 S3 兼容 API 直传**：Worker 只签发短时 URL，二进制不过 Worker；`/api/v1/attachments` 的 multipart 保留为降级路径（旧实例或签名失败时用）。
- **D10 四类实体统一进同步**：`memos`（评论本身也是 memo 行）/ `attachments` / `articles` / `memo_relations` 全部进增量同步与乐观锁；用**统一变更日志表 + 单调 `seq` 游标**，不用 `(updated_at, id)` 复合游标（避免同毫秒并列与跨表游标合并）。
- **D11 允许纯 PAT 换发设备令牌**：`POST /connect/token` 新增一个 `grant_type`，没有浏览器会话的客户端也能续期；换发出来的令牌仍归因到 `app_clients`，可撤销。
- **D12 Windows 构建与联调在本地虚拟机跑**：macOS 上开 Windows 虚拟机承担打包与签名验证；x64 产物仍需 x64 JDK 或 CI 产出（见 §6.8）。

### 1.2 本方案要推翻的现有书面边界

落地前需同步修改，否则后续 agent 会按旧边界干活：

- `docs/product-requirements.md:184`：「iOS/Android/鸿蒙原生 App 不在 FlareMo 范围；Web/PWA 是主形态」。
- `docs/liquid-glass-design.md:226`：「原生端——没有原生 app，PWA 即 web」。
- `ROADMAP.md`：「兼容层」「不再宣称第三方客户端可用」一段的口径（原生端是一方客户端，不走 Memos 兼容面）。

### 1.3 为什么不是另外三条路（留档）

| 方案 | 四端覆盖 | 编辑器是否 WebView | 一个人能否维护 |
| --- | --- | --- | --- |
| 纯原生（本方案） | ✅（两栈） | ❌ 原生 | 两栈，AI 辅助下可行 |
| React Native | ❌ 桌面要另做 | ✅（只能 WebView） | 两套 UI + 一套桌面 |
| Flutter | ✅ 一套代码 | ❌ | 一套代码，但 UI 全量 Dart 重写 |
| WebView 外壳 | ✅ | ✅ | 最省，但 iOS 丢 SW/Web Push，且手感不达标 |

---

## 2. 总体架构

```
                    ┌──────────────────────────────┐
                    │  packages/contracts (Zod)     │  ← 唯一事实源
                    └──────────────┬───────────────┘
                                   │ /api/app/openapi.json
      ┌────────────────────────────┼────────────────────────────┐
      │                            │                            │
┌─────▼──────┐              ┌──────▼───────┐             ┌──────▼───────┐
│ FlareMoKit │              │ flaremo-core │             │  apps/web    │
│  (Swift)   │              │  (Kotlin)    │             │  (React)     │
└─────┬──────┘              └──────┬───────┘             └──────┬───────┘
      │                            │                            │
┌─────▼──────┐              ┌──────▼───────┐                    │
│ macOS / iOS│              │ Android / Win│                    │
└────────────┘              └──────────────┘                    │
      └──────────────┬─────────────┴────────────────────────────┘
                     ▼
            Cloudflare Worker（Hono + D1 + R2）
```

三条共享管线：

1. **契约管线**：`packages/contracts` → `/api/app/openapi.json` → Swift/Kotlin DTO 生成。响应结构与字段名只有一处定义。
2. **数据语义管线**：云端 D1 是 SQLite，本地也是 SQLite；同一套表结构、同一套 `updated_at + id` 游标、同一套软删语义。
3. **设计管线**：`index.css` 的 oklch token → CI 转 sRGB → 生成 `Theme.swift` / `Theme.kt`。禁止在两个原生端手抄颜色。

---

## 3. 仓库布局

沿用现有 pnpm monorepo，不另开仓库（同版本、同 PR、同发布节奏）：

```
FlareMo/
├── apps/
│   ├── web/                # 现有 React（完整客户端）
│   ├── worker/
│   ├── apple/              # 新增：FlareMo.xcodeproj（macOS + iOS target）
│   └── kotlin/             # 新增：settings.gradle.kts（androidApp + desktopApp）
├── packages/
│   ├── contracts/          # 现有：Zod schema + OpenAPI
│   ├── apple/FlareMoKit/   # 新增：本地 SwiftPM 包（Core / Design / Markdown）
│   └── kotlin/             # 新增：core:model / core:network / core:db / core:domain / shared:ui
└── docs/
```

- **内核用包、App 用工程**：SwiftPM 至今不能产出 `.app`，所以 `FlareMoKit` 是本地包，`apps/apple` 里是手写的 `.xcodeproj`。
- **Xcode 27.2 起项目文件默认 JSON（`project.xcproj`）**，可读、merge 冲突少，**因此不引入 Tuist / XcodeGen**（它们的历史理由就是 pbxproj 不可读）。要求团队统一 Xcode ≥ 27.2。
- Kotlin 侧只建 `androidApp` 与 `desktopApp` 两个 app 模块；**iOS target 现在不建**（将来加 `iosMain` 只需换网络引擎）。

---

## 4. 后端契约（M0，必须先做）

### 4.1 已经具备的（不用重做）

- **客户端接入层已实现并提交**：`apps/worker/src/routes/connect-api.ts` 提供 `POST /connect/device`、`POST /connect/token`、`POST /api/app/connect/approve`、`GET|DELETE /api/app/connect/apps/:id`，配对页 `apps/web/src/pages/connect-page.tsx` 已上线，三张表（`app_clients` / `device_authorizations` / `device_refresh_tokens`）已建（migration `0046`）。access 14 天、refresh 90 天。
- **增量同步所需的索引**：`memos_user_updated_id_idx (user_id, updated_at, id)` 已存在；`updated_at` 是 `toISOString()` 毫秒文本，字典序 = 时间序。D10 定案后同步走 `sync_changes.seq`，这个索引留给「全量对齐 / 降级轮询」用。
- **四类实体的现状**：`attachments` / `articles` 都已有 `updated_at` + `deleted_at`；**评论不是独立表**——它是一条完整的 `memos` 行，外加一条 `memo_relations(memo_id=评论, related_memo_id=父记录, type='comment')`，所以给 `memos` 加 `version` 就顺带覆盖了评论的乐观锁。
- **软删天然是 tombstone**：`memos.status` + `deleted_at` 已有，进回收站即写 `deletedAt/updatedAt`。
- **幂等创建**：`memos_user_client_id_idx UNIQUE(user_id, client_id)` 已存在，`createMemo` 命中即返回已有记录，离线重放可直接复用。
- **SSE**：`/api/v1/sse` 支持 `Last-Event-ID`，保留 7 天。**注意它是兼容层**：服务端每个连接每 5 秒查一次 D1（`memos-sse.ts` 的 `eventPollIntervalMs`），Web 端目前没有任何消费者。原生端不以它作同步源（见 §4.10）。
- **OpenAPI 3.1**：`packages/contracts/src/openapi-current/` 手写 path 表 + `zod.toJSONSchema` 产 schema，只覆盖 `/api/v1`。

### 4.2 缺口清单

| 缺口 | 现状 | 工作量 |
| --- | --- | --- |
| `version` 列（`memos` / `attachments` / `articles`） | 无；评论本身是 `memos` 行，加在 `memos` 上即覆盖 | 0.5 人日 |
| `memo_relations.updated_at`（评论关系的增量同步） | 只有 `created_at` | 0.5 人日 |
| `sync_changes` 变更日志表 + 触发器 + 回填 | 无 | 1.5 人日 |
| `GET /api/app/sync/changes`（`seq` 游标） | 无（CEL `updated_ts` 不下推、>5000 行报错，不能拿来当同步） | 2 人日 |
| `GET /api/app/instance` 能力发现 | 无（只有 `/api/app/health` 返回 version） | 0.5 人日 |
| `/api/app` 的 OpenAPI | 无 | 1.5–2 人日 |
| **附件 S3 直传**：`upload-url` + `complete` 两个端点、R2 SigV4 签名、缩略图双对象 | 无签名直传，只能 multipart 经 Worker | 2–3 人日 |
| **纯 PAT 换发**：`POST /connect/token` 新增 `grant_type` | 只有 `device_code` / `refresh_token` | 1 人日 |
| APNs / FCM 推送注册 | 只有 VAPID Web Push | 2.5 人日 |
| ASR 放行 Bearer | `getBrowserRequestContext` 首行硬拒 `authorization` | 0.5 人日 |

**合计约 12.5–14 人日**，对应 M0 的 3 周。三项新决定（D9/D10/D11）让 M0 从 8.5 人日涨到 13 人日上下，但换来的是「附件不弱网卡死」「四类实体一套游标」「无浏览器也能续期」。

### 4.3 迁移 0048

下一个可用编号是 `0048`（`0046` / `0047` 已用）。**必须用 `pnpm db:generate` 生成**（同时写 `migrations/meta/_journal.json` 与 `0048_snapshot.json`；`packages/db/src/test-migrations.ts` 按 journal 建库，手写 SQL 会漏 snapshot）。D1 只支持 `ADD COLUMN`（默认值必须常量），不支持改列。

**拆成两个迁移**：`0048` 用 `pnpm db:generate` 生成（列 + 新表）；`0049` 用 `pnpm exec drizzle-kit generate --custom` 生成后手写（触发器 + 回填，见 §4.3.1）。仓库里 `0038` / `0044` 就是这类手写迁移，FTS 触发器也早有先例。

```sql
-- migrations/0048_native_sync.sql（生成）
ALTER TABLE `memos` ADD `version` integer NOT NULL DEFAULT 1;
ALTER TABLE `attachments` ADD `version` integer NOT NULL DEFAULT 1;
ALTER TABLE `articles` ADD `version` integer NOT NULL DEFAULT 1;
ALTER TABLE `memo_relations` ADD `updated_at` text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

-- 统一变更日志：客户端只认一个单调 seq，四类实体共用
CREATE TABLE `sync_changes` (
  `seq` integer PRIMARY KEY AUTOINCREMENT,
  `user_id` text NOT NULL,
  `entity` text NOT NULL,        -- 'memo' | 'attachment' | 'article' | 'relation'
  `entity_id` text NOT NULL,
  `op` text NOT NULL,            -- 'upsert' | 'delete'
  `version` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL
);
CREATE INDEX `sync_changes_user_seq_idx` ON `sync_changes` (`user_id`, `seq`);

CREATE TABLE `native_push_devices` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `platform` text NOT NULL,              -- 'ios' | 'android' | 'macos' | 'windows'
  `token` text NOT NULL,
  `environment` text NOT NULL DEFAULT 'production',
  `revoked_at` text,
  `last_seen_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `native_push_devices_token_idx` ON `native_push_devices` (`platform`,`token`);
CREATE INDEX `native_push_devices_user_idx` ON `native_push_devices` (`user_id`);
```

#### 4.3.1 触发器与回填（0049，手写迁移）

把**所有写路径**都落到 `sync_changes`，客户端只消费一个 `seq`：

```sql
-- migrations/0049_native_sync_triggers.sql（generate --custom）
CREATE TRIGGER `sync_memos_ai` AFTER INSERT ON `memos` BEGIN
  INSERT INTO `sync_changes` (`user_id`,`entity`,`entity_id`,`op`,`version`,`updated_at`)
  VALUES (NEW.`user_id`, 'memo', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;

CREATE TRIGGER `sync_memos_au` AFTER UPDATE ON `memos` BEGIN
  INSERT INTO `sync_changes` (`user_id`,`entity`,`entity_id`,`op`,`version`,`updated_at`)
  VALUES (NEW.`user_id`, 'memo', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;

-- attachments / articles：结构与上面同构，entity 分别为 'attachment' / 'article'
-- memo_relations：AFTER INSERT / AFTER DELETE 两个触发器，entity='relation'，
--   entity_id 用 NEW.`memo_id`（评论 memo 的 id），
--   user_id 由 `SELECT `user_id` FROM `memos` WHERE `id` = NEW.`memo_id`` 取

UPDATE `memo_relations` SET `updated_at` = `created_at`
WHERE `updated_at` = '1970-01-01T00:00:00.000Z';

-- 回填：存量各生成一条，客户端第一次拉取即可对齐
INSERT INTO `sync_changes` (`user_id`,`entity`,`entity_id`,`op`,`version`,`updated_at`)
SELECT `user_id`,'memo',`id`, CASE WHEN `deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,`version`,`updated_at` FROM `memos`;
-- attachments / articles / memo_relations 同理，各自一条 INSERT ... SELECT
```

- **清理**：`sync_changes` 在 cron 维护 pass 里按 30 天裁剪（与 `FLAREMO_TRASH_RETENTION_DAYS` 对齐，`apps/worker/src/scheduled-tasks.ts` 已有逐 pass 隔离的骨架）；客户端 `since` 早于裁剪点即 410。
- **写放大**：每次写多一条 INSERT，只存引用不存正文，单行约 100B；1 万条回填约 1MB，可接受。
- **为什么不用 `(updated_at, id)`**：跨四张表要合并四个游标；同毫秒并列要靠 id 兜底；而 `seq` 天然全序、一个 `since` 拉全部。
- **最后写入者胜（LWW）**：乐观锁仍用各表的 `version`。评论是 append-only（`memos-comments.ts` 只创建、不编辑），关系行用 `updated_at` 参与同步即可。

### 4.4 增量同步契约

| 方法 | 路径 | 认证 | 关键字段 | 状态 |
| --- | --- | --- | --- | --- |
| GET | `/api/app/sync/changes` | Bearer | `since`(seq)、`limit≤500`、`next_seq`、`has_more` | 新增 |
| POST | `/api/app/memos` | Bearer | `payload.client_id` 幂等 | 已有 |
| PATCH | `/api/app/memos/:id` | Bearer | 新增 `expected_version`（或 `If-Match`） | 部分 |
| POST | `/api/app/attachments/upload-url` | Bearer | 返回原图 + 缩略图两个直传 URL | 新增 |
| POST | `/api/app/attachments/:id/complete` | Bearer | HEAD 校验对象落盘后置 ready | 新增 |
| POST | `/api/v1/attachments` | Bearer | multipart + `client_id`，25 MiB（降级路径） | 已有 |
| GET | `/api/app/instance` | 匿名可缓存 | `version` + `capabilities` | 新增 |
| GET | `/api/v1/sse` | Bearer | `Last-Event-ID`，7 天 | 已有 |

游标：**单调递增的整数 `seq`**（来自 `sync_changes.seq`），不用 `(updated_at, id)`。一个游标覆盖四类实体，跨表无需合并。

```json
// GET /api/app/sync/changes?since=1024&limit=500
{
  "changes": [
    { "seq": 1025, "entity": "memo",       "id": "memo_xxx",  "op": "upsert", "version": 7, "updated_at": "2026-11-08T12:00:00.123Z" },
    { "seq": 1026, "entity": "relation",   "id": "memo_zzz",  "op": "upsert", "version": 0, "updated_at": "2026-11-08T12:00:01.000Z" },
    { "seq": 1027, "entity": "attachment", "id": "att_aaa",   "op": "delete", "version": 3, "updated_at": "2026-11-08T12:01:00.456Z" }
  ],
  "next_seq": 1027,
  "has_more": true
}
```

- 返回的是**引用**，不内联正文：客户端按 `entity` 批量补正文（`POST /api/app/sync/hydrate`，一次 ≤200 个 id，返回 memo/attachment/article 三类正文）。这样一次同步响应不会被长文撑爆，弱网也不至于整轮重来。**hydrate 计入上面的「同步端点 2 人日」。**
- 删除记录保留 **30 天**（`FLAREMO_TRASH_RETENTION_DAYS` 默认 30，之后硬删；`sync_changes` 同步裁剪）。`since` 早于裁剪点服务端返回 **410**，客户端走「全量重建」路径。
- **实时性不靠长连接**：服务端有变更 → APNs/FCM 静默推送 → 客户端唤醒后 pull 一次。**SSE 只作桌面可选通道，移动端一律不挂**（理由见 §4.10）；断线超过 7 天或收 410 用 pull 补洞。
- **不要**用 `GET /api/app/memos?order_by=updated_at` 当同步（分页 + CEL 限制会漏记录），它只作旧实例的降级兼容。

### 4.5 冲突与幂等

- **LWW + 乐观锁**，单语句原子更新：`UPDATE memos SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?`，`changes = 0` → 返回 409，客户端拉最新版本后重试。`attachments` / `articles` 同一套（都是 `version` 列）。
- **不做字段级合并**：`content` 是整篇 Markdown，字段级合并会产出脏文本。
- **评论是 append-only**：`memos-comments.ts` 只创建评论（评论本身是一条 `memos` 行），没有编辑入口，所以不需要编辑冲突处理；删除走 memo 的软删，客户端的删除同步由 `entity=memo` + `entity=relation` 两条共同覆盖。
- 创建幂等靠 `client_id`（`memos_user_client_id_idx`）；附件同理。

### 4.6 能力发现

`/api/app/health` 不动（已有 `version/product/team_layout/email_provider`）。新增匿名可缓存的 `GET /api/app/instance`：

```json
{ "version": "0.31.0",
  "api_versions": ["app-v1"],
  "capabilities": { "sync_changes": 1, "sync_hydrate": 1, "optimistic_lock": 1,
                    "soft_delete_tombstone": 1, "native_push": ["apns", "fcm"],
                    "direct_upload": 1, "pat_grant": 1 } }
```

客户端按 `capabilities` 降级：没有 `sync_changes` 就退回 `order_by=updated_at asc` 轮询；旧实例 404 不阻塞启动。

### 4.7 `/api/app` 的 OpenAPI

- **不推荐**逐路由改 `createRoute`（`@hono/zod-openapi` 并不在依赖里，只有 `@hono/zod-validator`；要重写 `/api/app` 主树 38 个端点 + 10 个子 app）。
- **推荐**新建 `packages/contracts/src/openapi-app/`，照搬 `openapi-current/` 的结构：path 表手写、schema 用 `zod.toJSONSchema` 从现有 Zod 批量生成，路由加 `/api/app/openapi.json`（同缓存策略）。零路由改动。
- 门禁：`apps/worker/src/compatibility/openapi-coverage.test.ts` 已用 Hono 路由表对 `/api/v1` 双向断言，把 `includes("/api/v1")` 扩到 `/api/app` 即可；生成物只当测试夹具，不入库。

### 4.8 附件直传（D9）

- **路径**：`POST /api/app/attachments/upload-url` 返回 `{attachment_id, original:{url,headers}, thumbnail:{url,headers}, expires_at}`；客户端直接 `PUT` 到 R2（原图 + 640px 缩略图两个对象），完成后 `POST /api/app/attachments/:id/complete`，Worker 用 `HEAD` 校验对象存在与大小再置 `ready`。
- **签名**：走 R2 的 S3 兼容 API + SigV4，用 WebCrypto 的 HMAC-SHA256 在 Worker 内手写签名（约 200 行）；需要新增 secret `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`——**只靠 binding 签不了预签名 URL**。
- **原生端不需要 CORS**（HTTP 客户端不受浏览器同源策略约束）；Web 端若复用该端点需要给 bucket 配 CORS，v1 不做。
- **降级**：实例没有 `direct_upload` 能力或签名失败 → 回落 `POST /api/v1/attachments` multipart。
- **代价**：Worker 不再承担 25MiB 流量，但多了一个可直接写的签名面——URL 必须短时（建议 10 分钟）、绑定单对象、限制大小与 content-type。

### 4.9 纯 PAT 换发（D11）

- `POST /connect/token` 新增 `grant_type=urn:flaremo:grant-type:pat`：客户端用用户手动创建的 PAT 换 access + refresh，供没有浏览器会话的场景（脚本、换机后只剩 PAT）。
- 兑换时校验 PAT 的 scope（`notes` / `admin`）与撤销状态，并把令牌归因到 `app_clients`，保证「已连接应用」页能看见、能撤销。
- 风险控制：按 PAT 限流（如每小时 N 次）、写审计、`admin` scope 的 PAT 是否允许换发需要单独确认（默认**不允许**，管理面必须走浏览器会话）。

### 4.10 推送与 ASR

- **ASR 放行 Bearer**：拆 `apps/worker/src/context.ts:347` 的 `getBrowserRequestContext`（首行硬拒 `authorization`），抽出 `requireCookieSession`；调用点 `routes/capture-api.ts` 的 `/status`、`/ws`、`/transcribe` 与 `bridgeCapture` 回调共 4 处换成 `getRequestContext`；`/ws` 的 Origin 校验保留。
- **APNs**：Workers 出站 `fetch` 走 HTTP/2，可行；provider token 用 WebCrypto ES256 签，与现有 VAPID 同思路。**FCM v1**：HTTPS POST + OAuth2 JWT，同理。设备表见 §4.3。
- **实时通道怎么选**：`/api/v1/sse` 是 Memos 兼容层，实现是「每个连接每 5 秒查一次 D1」（Workers 没有跨 isolate 的 pub/sub），成本随「连接数 × 常开时长」线性放大。所以原生端：**桌面窗口可见时可挂，移动端不挂，后台一律断开**；实时性由 APNs/FCM 唤醒 + pull 提供，空闲时零连接、零查询。真要优化这个端点，把 `eventPollIntervalMs` 调大是一行改动；换成 Durable Object 做真广播另算架构成本，现在不做。
- **原生 v1 的语音走批量转写**（`asr/batch.ts` + `/transcribe`），不做流式 WebSocket——流式要处理 PCM 帧与断线续传，成本是批量的数倍。

### 4.11 已定事项

原「待拍板」三项已于 2026-11-08 定案，落到 D9 / D10 / D11：

1. **附件直传** ✅ 做（R2 S3 兼容 API，multipart 保留降级）。
2. **`version` 覆盖范围** ✅ `memos` / `attachments` / `articles` 加 `version`；评论本身是 `memos` 行，自动覆盖；`memo_relations` 加 `updated_at` 参与同步。
3. **纯 PAT 续发** ✅ 允许，新增 `grant_type`，`admin` scope 默认不开放。

遗留待定：`admin` 类 PAT 是否允许换发；`sync_changes` 是否也给 `shares` / `tasks` 用（v1 不同步，任务在原生端只读或后续补）。

**配套要求（必做，非待定）**：`POST /api/app/memos` 与 `/api/app/articles` 必须接受**客户端生成的 UUIDv7 id**并保持幂等，否则离线创建的笔记在同步前无法被引用、排期或评论（本地存储的做法见 §7.7）。工作量约 0.5 人日，未计入上面的估算。

---

## 5. Apple 端（macOS 先，iOS 第三步）

### 5.1 工具链与部署目标

- **Xcode 27.2**（2026-10-29，需 macOS 26.6+）、**Swift 6.4.2**，开启 Swift 6 语言模式与 `defaultIsolation(MainActor)`。
- **部署目标：macOS 26.0 / iOS 26.0**。理由：macOS 26 约占 Mac 装机 86%（TelemetryDeck 第三方遥测，2026-07 周）；iOS 26 全机型约 79%、近四年机型约 86%（Apple 2026-06 采样）；且链接 iOS 27 SDK 即强制 Liquid Glass，26 起步不会出现两套外观。
- **代价**：iOS 端会放弃约 21% 在用 iPhone（全机型口径）。iOS 是第三期才做，**到 M3 时重新核一次市占再定**；要下沉只需把 UI 包降到 iOS 18（内核包不含 26 API），届时 `UIDesignRequiresCompatibility` 的失效时间表需再查（Apple 明确不公布时间表）。
- 本机前置：**装 Xcode**（当前未装，约 40GB）、Apple Developer Program（$99/年，iOS 与 macOS 公证都要）。

### 5.2 工程结构与模块

```
apps/apple/FlareMo.xcodeproj
├── FlareMo-macOS        (SwiftUI, macOS 26+)
├── FlareMo-iOS          (SwiftUI, iOS 26+)      # M3 才建
├── FlareMoShareExtension(iOS)                    # M3
└── packages/apple/FlareMoKit/
    ├── Core/     API 客户端（生成的）、Auth、Sync、Store（GRDB）、Models
    ├── Design/   Theme（生成）、组件、字体
    └── Markdown/ 解析 + 内联样式计算（纯逻辑，可单测）
```

**编辑器不放进共享包**：`NSTextView`（macOS）与 `UITextView`（iOS）的视图层各写一份，样式计算层（纯 Swift）放 `Markdown/` 共享。

### 5.3 依赖清单（全部过 D7 白名单）

| 用途 | 库 | 版本 | 许可证 | 风险 |
| --- | --- | --- | --- | --- |
| 本地库 / 同步 | GRDB.swift | 7.12.0（2026-11-01） | MIT | SPM 下不能用自定义 SQLite 构建，用系统 SQLite |
| HTTP 客户端 | swift-openapi-generator / -runtime | 1.14.4 / 1.11.x | Apache-2.0 | 3.1 nullable `$ref` 会丢字段（issue #906/#950），必须契约测试兜底 |
| Markdown 解析 | swift-markdown | 0.9.0（2026-09-21） | Apache-2.0 | 仍是 0.x，API 会变，锁版本 |
| 快照测试 | swift-snapshot-testing | 1.19.7（2026-10-21） | MIT | 需锁 locale/字体/窗口尺寸 |
| macOS 自动更新 | Sparkle | 2.10.1（2026-10-25） | MIT | 密钥管理要进 CI secret |
| macOS 全局热键 | KeyboardShortcuts | 3.1.0（2026-09-11） | MIT | — |
| Keychain（可选替代） | Valet | 5.1.1 | Apache-2.0 | 自写 SecItem 封装亦可（约 150 行） |
| 测试框架 | Swift Testing | Xcode 27.2 内置 | Apache-2.0 | XCUITest 与性能指标仍只能用 XCTest |

**明确不选**：SwiftData（无 FTS5、无 SQL 访问、迁移与后台并发不可控）、Core Data（无 Swift 并发模型）、STTextView（**GPL-3.0/商业双许可**，见 §5.10）、MarkdownUI（2024-10 后停更、长文掉帧）、Splash（2021 停更）、MASShortcut（无维护）、KeychainAccess（2021 停更）、Alamofire。

### 5.4 数据层与搜索

- 本地用 **GRDB + 系统 SQLite**，与 D1 同构；直接复用 `migrations/*.sql` 里可复用的部分，语义（软删、`updated_at` 毫秒文本、游标）与云端一致。
- **FTS5 caveat（必须验收）**：服务端 `memos_fts` 用 `unicode61`，CJK 连续文本被当单 token，所以服务端中文搜索实为 `LIKE %关键词%` 降级（`memos-read.ts:117`）。本地若用 `trigram` 召回更好但**要求 ≥3 字符**，两个汉字的查询搜不到，且与 Web 端结果不一致。
  **策略**：本地建 `trigram` 索引 + **短 CJK 查询（<3 字符）降级 LIKE**，行为对齐服务端；在线时优先服务端搜索。把「中文两字搜索」写进 M1 验收项。
- 同步引擎：单写者 outbox + 水位游标 + `client_id` 幂等 + 冷启动全量对齐（见 §7.5）。

### 5.5 编辑器

- macOS 用 `NSTextView`，iOS 用 `UITextView`，均走 **TextKit 2**，保留 TextKit 1 逃生开关（超大文档）。
- v1 形态：**Markdown 源码 + 实时行内样式**（标题/加粗/代码/列表/引用/待办），不做 WYSIWYG，不内联图片（只显示附件占位）。移动端尤其简单：纯源码 + 底部工具条，对齐 flomo 的输入模型。
- 三个已知坑：
  1. **只改变更范围的属性**，整段重设属性会让 TextKit 2 丢弃 layout fragment 缓存 → 打字卡顿。
  2. `setMarkedText` 期间 AppKit 可能不发 `textDidChange` → 中日韩输入法组字时 SwiftUI 高度不刷新，需手动触发 layout。
  3. 撤销栈、查找、听写、Accessibility、服务菜单全部原生（这是选系统控件的最大理由）。

### 5.6 Markdown 渲染

`swift-markdown` 解析成块模型 → 自绘 SwiftUI（只渲染阅读态：卡片、详情、回顾）。块模型与编辑器的样式计算共用一份，放内核包做单测。**v1 不做代码高亮**；要做时用 Highlightr 2.3.0（MIT，JavaScriptCore，有主线程成本）或构建期把 shiki 转 token JSON。

### 5.7 系统集成

| 能力 | macOS | iOS |
| --- | --- | --- |
| 速记入口 | `MenuBarExtra` + 全局热键（⌘⇧Space）+ 服务菜单 + 拖入文件 | Share Extension + App Intents（Siri「记一条」）+ WidgetKit |
| 搜索 | 应用内搜索 + `CoreSpotlight` | 应用内 + `CoreSpotlight` |
| 同步 | 前台 pull + 可选 SSE（窗口可见时） | 前台 pull + APNs 唤醒；`BGTaskScheduler` 只兜底 |
| 通知 | `UNUserNotificationCenter` | APNs |
| 多窗口 | ✅ | — |
| Live Activity | — | v1 不做（无「进行中」语义） |

**扩展与主 App 不能同写一个 SQLite**：Share Extension 只写 App Group 内的 outbox 表，主 App 消费落库。

### 5.8 分发

- **macOS**：Developer ID 签名 → `codesign --options runtime` → `xcrun notarytool submit --wait` → `stapler staple` → DMG；自动更新走 Sparkle 2（`generate_keys` 产 EdDSA 密钥，公钥进 Info.plist `SUPublicEDKey`，私钥进 CI secret，`generate_appcast` 产签名 appcast）。
- **iOS**：TestFlight → App Store。审核前必须准备：**可登录的 demo 实例 + 演示账号**（审核员进不了自托管实例是 4.2 被拒的第一原因）、`PrivacyInfo.xcprivacy` 隐私清单、隐私政策 URL。构建 90 天过期，按节奏重传。
- **AGPL-3.0 与 App Store**：当前 `LICENSE` 是纯 AGPL-3.0，与 App Store 的附加限制冲突（VLC 2011 年因此下架）。**必须加 §7 additional permission**（允许经应用商店分发，同版本源码在 GitHub 可得），有现成先例可抄。这是 M1 前必须完成的法务前置。

### 5.9 测试

- 内核与网络层用 **Swift Testing**（`#expect` / `#require` / 参数化）——最适合「同步水位、FTS 查询、迁移」这类纯函数。
- UI 自动化与性能指标只能用 **XCTest**（WWDC26 session 267 明确）；性能基线用 `XCTMetric`（`XCTClockMetric` / `XCTMemoryMetric`）固定场景跑。
- UI 快照用 `swift-snapshot-testing`，必须固定 locale、字体、窗口尺寸，否则跨机 diff。

### 5.10 最容易翻车的三个点（Apple 侧）

1. **中文搜索的「同构」是伪命题**（§5.4）——两端结果会不一样，要当成独立验收项设计，而不是「选完数据库就完事」。
2. **许可证传导**：STTextView 的 `LICENSE.md` 实为 GPL-3.0 / 商业双许可，README 不写。对 AGPL 项目「用」没问题，但**上 App Store 会把发布链路拖回 GPLv3 §6「安装信息」的老问题**。所以编辑器退回系统控件，并把样式计算层留在共享内核。
3. **Xcode 27.2 项目格式锁定**：低于 27.2 打不开工程；若团队机器不齐，回退方案是 XcodeGen + 传统 pbxproj（Tuist 对新 JSON 格式的稳定支持未找到可靠来源）。

---

## 6. Kotlin 端（Android 第二步，Windows 第四步复用）

### 6.1 工具链

- **Kotlin 2.4.21**（2.5.0 计划 2026-12，别提前上）、**JDK 21 LTS**、**Gradle 9.5.0**、**AGP 9.3.0**、**Compose Multiplatform 1.12.2**（1.13.0-beta02 已于 11-04 发布，不跟）。
- **minSdk 26 / targetSdk 36**（Play 自 2026-08-31 起要求新应用与更新 ≥36）/ compileSdk 37（若 API 37 未定稿则用 36）。
- 锁定版本，不跟随升级：Gradle 9.8/9.9 与 AGP 10.0（年底）会改 DSL；CMP 1.13 移除 JRE 字体是破坏性变更。

### 6.2 工程结构

```
apps/kotlin/
├── androidApp/     # Activity、分享入口、通知、Glance 小组件
└── desktopApp/     # Windows 窗口、托盘、热键、文件关联、更新器
packages/kotlin/
├── core/model/     # 数据模型（与 contracts 对齐）
├── core/network/   # Ktor + 手写轻量 client（约 30 端点；SSE 仅桌面可选）
├── core/db/        # Room 3 + BundledSQLiteDriver + FTS5
├── core/domain/    # 同步引擎、仓库层
└── shared/ui/      # Compose 多平台 UI（只依赖 Compose API）
```

`expect/actual` 只保留三个平台入口：DI 初始化、通知、文件路径——其余走 interface + Koin 注入。`shared/ui` 里不许出现窗口、托盘、剪贴板（全部下放 `desktopMain`）。**iOS target 现在不建**。

### 6.3 依赖清单

| 用途 | 库 | 版本 | 许可证 | 风险 |
| --- | --- | --- | --- | --- |
| 语言 / 构建 | Kotlin / Gradle / AGP | 2.4.21 / 9.5.0 / 9.3.0 | Apache-2.0 | 年底有大版本变更 |
| UI | Compose Multiplatform | 1.12.2 | Apache-2.0 | 1.13 破坏性变更 |
| 网络 | Ktor client（OkHttp 引擎；SSE 插件仅桌面用） | 3.6.0 | Apache-2.0 | 引擎影响 Android 体积 |
| 序列化 | kotlinx.serialization | 1.9.x | Apache-2.0 | — |
| 数据库 | Room 3 + `BundledSQLiteDriver` | 3.0.3 | Apache-2.0 | 版本线较新；FTS5 需手写迁移 |
| DI | Koin | 4.2.x | Apache-2.0 | 错误只在运行时暴露 |
| 生命周期 | androidx.lifecycle | 2.11.0 | Apache-2.0 | 桌面需手接 `LifecycleOwner` |
| 导航 | androidx.navigation (CMP) | 2.10 | Apache-2.0 | 桌面无系统返回键，需自建返回栈 |
| 图片 | Coil | 3.x | Apache-2.0 | 精确 patch 未锁 |
| Android 小组件 | Glance | 1.2.0 | Apache-2.0 | 传递的 `work-runtime-ktx:2.7.1` 要显式 pin 到 2.9+ |
| 后台任务 | WorkManager | 2.10.x | Apache-2.0 | Android 14+ FGS 类型限制 |
| 桌面集成（可选） | Nucleus | 2.5 | MIT | 年轻；JNI 与 JNA/JBR 需验证 |

**明确不选**：SQLDelight（Android driver 用系统 SQLite，2026-05 仍有厂商镜像报 `no such module: fts5`；三端 SQLite 版本不齐会让「本地与 D1 同构」落空）、Voyager（维护度低）、`openapi-generator` 的 `kotlin/jvm-ktor` 客户端生成（2026 仍有编译级 bug #23762；**只生成 models，api 手写**）。

### 6.4 数据层

- **Room 3 + `BundledSQLiteDriver`**：Android/JVM 用同一份打包 SQLite（版本可控），`androidx.room3.Fts5` 官方支持。
- **CJK 搜索必须复刻服务端降级逻辑**（§5.4）：本地 trigram + 短 CJK 查询 LIKE，否则两端结果不一致。
- 启动时若 FTS5 不可用要能降级（建表失败不能崩）。

### 6.5 导航 / DI / UI

- 导航用 JetBrains 版 `navigation-compose` 2.10；桌面**没有系统返回**，返回栈要接到标题栏返回箭头 + 鼠标侧键 + `Alt+←`，窗口关闭前状态用 `rememberSaveable` 恢复。
- Material3 只用稳定组件；Coil 3 加载图片；长列表 `LazyColumn` 必须给 `key` + `contentType`，否则 1000+ 卡片掉帧。
- **Ember token**：Skia 不支持 oklch，必须先在 CI 转 sRGB 再生成 Compose Theme（见 §7.2）。

### 6.6 Android 集成

- 分享入口：`ACTION_SEND`（`text/plain` + `image/*`）intent-filter，从任何 App 直接速记——这是 Android 相对 iOS 最容易拿到的入口。
- 后台同步：`WorkManager`；通知渠道 + `POST_NOTIFICATIONS` 运行时权限。
- 桌面小组件：Glance；相机/相册用 Photo Picker（免存储权限）。
- 录音：必须前台服务 + `microphone` 类型；Android 12+ 禁止后台启动 FGS、14+ 需声明 `FOREGROUND_SERVICE_MICROPHONE` ——**录音随时可能被系统终止，产品要允许「录音中断可续」**。
- 上架：AAB、64 位、data safety 表。

### 6.7 Windows 桌面（最大未知，必须先 spike）

成熟度分级：**IME ⚠️ 中偏险 / 打包 ✅ 可用但受限 / 自动更新 ❌ 无官方方案**。

- **IME**：候选框位置与韩文重复已在 CMP 1.9 修复（CMP-8177、CMP-8200）；但 2026-04 仍有 Windows AWT IME 桥 NPE 的 P1 未根除（Android Studio 里中日韩完全无法输入）。→ **可以输入，但必须真机验收**：候选框跟随、组合串、中英混切。
- **打包**：`jpackage` 出 MSI 需 WiX，**且只能在 Windows 上编**；jlink 裁剪后 MSI 约 40–60MB、app-image 约 100MB。**不能从 macOS 交叉编译**。
- **自动更新**：无官方 updater；自建 = 「下载 MSI → 静默安装 → 重启」。社区有 kmp-app-updater，或评估 Conveyor（OSS 免费、可交叉构建、自带在线更新，但引入外部服务）。
- **其他已确认短板**：默认窗口无深色标题栏（需 DWM/JNA 或自绘 undecorated，自绘会丢 Aero Snap 阴影）；最小窗口尺寸被 density 放大（CMP-2285 未修）；Win10 字体渲染差（CMP-5359 未关）；托盘通知走 AWT 气泡而非 Action Center Toast；**全局快捷键无 API**（社区用 JNativeHook）；文件关联要绕 jpackage 参数。
- **建议**：把系统集成收敛成一个 `desktop-integration` 模块，优先评估 **Nucleus 2.5**（原生装饰/Toast/任务栏进度/全局热键/文件关联/打包/更新），失败再退回 JNA 自写。

### 6.8 构建、签名、更新（第四步的真实成本中心）

- **Windows 产物必须在 Windows 上打**（jpackage 不能从 macOS 交叉编译）。**D12：用本地 Windows 虚拟机承担**——在 M5 Pro 上开 Windows ARM 虚拟机（Parallels/UTM，Win11 ARM + x64 模拟）跑打包、签名验证与 IME 真机验收，比等 CI 快得多；GitHub Actions `windows-latest`（预装 WiX）或 Conveyor 作为备选/发布流水线。
  - 注意架构：ARM 虚拟机 + ARM JDK 产出 arm64 包；要出 **x64 包**需在虚拟机里装 x64 JDK（模拟执行，慢但可行），或最终交给 `windows-latest` 出 x64。
- **Windows 代码签名是硬成本**：Azure Artifact Signing（原 Trusted Signing）约 $9.99/月，但**个人仅限美/加，机构仅限美/加/欧/英——中国个人开发者拿不到**；只能走 OV 证书（约 $200–400/年，通常需企业主体），或接受 SmartScreen 红警。**虚拟机解决构建，不解决证书。**
- **MSIX 无第一方支持**（jpackage 只出 MSI/EXE）；Windows Store 上架 v1 不做。
- Android 签名免费（keystore + Play App Signing）。

### 6.9 最容易翻车的三个点（Kotlin 侧）

1. **Windows IME + 字体 + DPI**：中英混排、候选框、125%/150%/200% 缩放。建议**第一步就做 spike，不要先写 UI**。
2. **Windows 安装/更新/签名链路**：无交叉编译、无官方 updater、中国主体拿不到 Azure 个人签名。这是四端里唯一「技术不难但渠道很难」的一段。
3. **本地搜索语义漂移**：FTS5 版本差异 + CJK LIKE 降级 + trigram 限制，与 Web 结果不一致。

---

## 7. 共享层

### 7.1 契约 → 代码

- 唯一入口：`/api/app/openapi.json`（M0 产出）。
- Swift：`swift-openapi-generator` 生成 client + models，鉴权/重试/日志塞进自写 `HTTPClient` middleware。**接入第一步就跑「生成 + 契约覆盖测试」**（3.1 nullable `$ref` 有丢字段的已知 bug）。
- Kotlin：**只生成 models**（`kotlinx_serialization` 库选项），api 手写（约 30 端点的薄封装）+ 响应反序列化测试。理由是官方 `kotlin/jvm-ktor` 生成器仍有编译级 bug。
- 契约变更规则：**先改 `packages/contracts`，再重新生成两端 DTO**，不允许原生端手写字段名。

### 7.2 设计 token

- 事实源仍是 `apps/web/src/index.css`（约 234 个自定义属性，oklch 书写）。
- 生成脚本（Node）：解析 CSS → **把 oklch 转换成 sRGB**（Skia 不支持 oklch）→ 输出 `Theme.swift`（SwiftUI Color/Font/Spacing/Radius）与 `Theme.kt`（Compose）。
- 圆角直接映射（控件 10 / 卡片 14 / 弹窗 18）；纸纹用约 400 字节的内联 SVG 噪声（两端都能渲染）；字体 Geist（OFL-1.1，需核对随包许可证）、Noto Sans CJK / Noto Sans Arabic（OFL）——**字体必须打包进 App，不能依赖系统**，否则中英混排和阿拉伯语字形会漂。
- 禁止在原生端手写十六进制色值；CI 里加一条「Theme 文件由脚本生成」的校验。

### 7.3 i18n

- 事实源：`apps/web/src/i18n/messages/*.ts`（每语言约 1115 行，共 8 个）。
- 生成脚本把这些导出成 JSON → 转 `.xcstrings`（Apple 的 String Catalog）与 `compose-resources` 的 `values-*/strings.xml`。
- **v1 只做 zh-CN + en-US**；阿拉伯语 RTL 是 SwiftUI/Compose 原生能力，但文案与布局要单独验收，放 P2。

### 7.4 搜索语义一致性

三处必须同时满足，写进验收：

1. 中文 ≥3 字：本地 trigram 命中，服务端 FTS5 命中（行为接近）。
2. 中文 1–2 字：两端都降级 LIKE，结果一致。
3. 中英混排 + 标签/`has:attachment` 等操作符：操作符解析复用 `packages/contracts/search-query.ts` 的规则，两端实现同一份语法。

### 7.5 离线同步引擎（两栈同一算法）

```
写入：本地事务写 memo + version++ → 写入 outbox(pending) → 立即返回
附件：本地先落文件 → 取 upload-url → 直传 R2 → complete 置 ready（离线则排队）
上送：单写者串行 POST/PATCH（带 client_id / expected_version）
拉取：GET /sync/changes?since=<seq> → 取引用 → POST /sync/hydrate 补正文 → 事务内 upsert/delete → 更新 seq 水位
冲突：409 → 拉该条最新 → 覆盖本地（LWW）或提示用户
冷启动：seq 为空或收到 410 → 全量对齐（分页拉全量 + 重建本地库）
```

- **单写者**：同一时刻只跑一个 pull 与一个 push，避免 `seq` 竞态；`seq` 是单调整数，客户端只存一个水位。
- **本地优先**：断网可读可写；草稿与附件先落本地，联网后重放。
- **验收**：飞行模式写 10 条 → 恢复网络 → 服务端恰好 10 条（无重复）；带 1 张图与 1 条评论的完整往返；两台设备交替编辑同一 memo，最终一致且无脏文本。

### 7.6 版本兼容

- 客户端启动时读 `/api/app/instance` 的 `capabilities`，按能力降级；缺失能力不阻塞启动。
- 原生端不承诺兼容「N 个版本前」的实例：能力缺失即降级到 `order_by=updated_at asc` 轮询，再缺失即提示升级实例。这条要在设置页写清楚。

### 7.7 本地存储（最佳实践）

**一句话：本地 SQLite 是唯一事实源，UI 是它的响应式视图，网络只负责搬运变化。没有「缓存层」这个概念。**

#### 引擎与连接

| 项 | 取值 |
| --- | --- |
| Apple | GRDB 7 + 系统 SQLite（WAL） |
| Kotlin | Room 3 + `BundledSQLiteDriver`（SQLite 版本钉死在依赖里，不依赖系统） |
| PRAGMA | `journal_mode=WAL`、`synchronous=FULL`、`foreign_keys=ON`、`busy_timeout=5000`、`temp_store=MEMORY` |
| 连接 | 单写连接 + 多读连接（WAL 下读写并发）；写连接串行 |
| 事务 | 一次用户动作 = 一个事务（实体 + outbox + FTS 触发器一起提交） |

`synchronous=FULL` 的理由：速记是「打完字就合盖」的场景，宁可多一次 fsync，也不能丢。

#### 表分三层

**① 事实层**：`memos`、`memo_relations`、`attachments`（只存元数据）、`articles`、`tasks`，与服务端 1:1。外加三张本地表：`outbox`（待上送操作）、`sync_state`（`seq` 水位、`generation`、最后拉取/推送时间）、`blobs`（二进制元数据：sha256、bytes、mime、remote_key、state、last_used_at）。

**② 派生层**：`memos_fts`（FTS5 + `trigram`）、`tags`、计数与回顾候选。规则：派生层不许出现无法重算的数据；`derived_schema_version` 一变就整层删掉重建。

**③ 二进制层**：文件系统，内容寻址 `<appSupport>/blobs/<sha2>/<sha2>/<sha>`，库里只存 sha 与状态。

#### 写入路径

```
用户动作 → 事务{ 写实体（本地立刻可见） + 写 outbox + FTS 触发器 } → UI 立即刷新
              ↓
      outbox 单写者循环：按 created_at 串行上送 → 成功删行；409 → LWW 覆盖后删行
              ↓
      附件：文件先落 blobs(state=staged) → upload-url 直传 → complete → ready
```

`outbox` 必备列：`id`、`op`、`entity`、`entity_id`、`payload`、`idempotency_key`、`depends_on`、`attempts`、`next_attempt_at`、`created_at`。`depends_on` 表达「附件依赖 memo 已创建」「评论依赖父记录已创建」。

#### 读取路径

页面只查本地库，**导航不发起任何网络请求**。Apple 用 GRDB `ValueObservation`、Kotlin 用 Room `Flow`，UI 订阅查询；同步在后台把变化写进库，UI 自然刷新。这是「打开就是最新」的唯一可靠做法，也是原生端比 Web 快的那一半来源。

#### 三个全局约定

1. **ID 由客户端生成**：新建实体一律 UUIDv7（按时间有序、索引友好），服务端接受客户端 id（幂等）。这样离线创建的笔记在同步前就能被引用、排期、评论。
2. **时间**：`updated_at` 直接存服务端格式（ISO 毫秒文本），索引与排序沿用；同毫秒用 `(updated_at, id)` 兜底。
3. **删除**：镜像 `deleted_at`，查询默认过滤；30 天后随服务端一起清掉。

#### 二进制策略

- 缩略图：随列表预取，LRU 淘汰，硬上限 200MB。
- 原图 / 音频：按需下载，LRU 淘汰，硬上限 2GB（可配置）；**被 outbox 引用或用户标记「离线保留」的永不淘汰**。
- 未同步的本地文件永不删除；服务端确认并 complete 之后才允许进入淘汰候选。
- iOS：blobs 目录加 `isExcludedFromBackup`；数据库正常参与备份（它才是数据）。

#### 冲突与重建

- 推：`PATCH ... expected_version`；409 → 拉该条最新，LWW 覆盖本地，删 outbox 行；用户正在编辑的那条给一次「重试 / 接受服务端」选择。
- 拉：`seq` 单调，事务内批量 upsert（每批约 200 行）。
- **本地库是副本**：schema 变更不做迁移——bump 版本 → 保留 outbox → 整库重建 → 全量对齐。这是本地端最大的省钱点，不要把服务端那套迁移纪律抄过来。
- 收到 410 → `generation++` → 清空事实层（保留 outbox）→ 全量对齐。

#### 安全

- 数据库放受保护目录（iOS `Application Support` + Data Protection；Android 应用私有目录；桌面用户目录）。
- 应用层生物识别门禁（Face ID / Touch ID / Windows Hello / Android Biometric）只做 UI 门，不加密文件——真正的静态加密交给 OS（Data Protection / Android FBE / FileVault / BitLocker）。
- **不用 SQLCipher**：它与「Apple 用系统 SQLite」的决定冲突（要自编 SQLite），而在 OS 加密之上收益很小。

#### 明确不做

- 不把二进制塞进 SQLite。
- 不用 iCloud/CloudKit 做同步（同步只认自托管实例的 `seq`）。
- 不引入 Realm / WatermelonDB / PouchDB。
- 不把 Markdown 当唯一存储格式（必须有列可查）。
- 不给本地库写迁移脚本。

---

## 8. 里程碑与验收

| 里程碑 | 内容 | 估时（agent 口径） | 验收标准 |
| --- | --- | --- | --- |
| **M0 后端契约** | 0048 列/表、0049 触发器与回填、`/sync/changes` + `/sync/hydrate`、`/instance`、`/api/app` OpenAPI、**附件 S3 直传**、**纯 PAT 换发**、ASR Bearer、APNs/FCM、覆盖测试 | 3 周（12.5–14 人日） | OpenAPI 覆盖测试全绿；curl 跑通「同步 → hydrate → 409 冲突」；直传 PUT 成功且 complete 置 ready；PAT 换发拿到 refresh |
| **M1 macOS** | 5 屏 + 本地库 + 同步引擎 + 菜单栏/全局热键/服务菜单/拖拽 + Sparkle + 公证 | 4–6 周 | 飞行模式可写可读；⌘⇧Space 唤起即写；DMG 公证通过；中文两字搜索正确 |
| **M2 Android** | 同 5 屏 + `ACTION_SEND` + WorkManager + 通知 + Play 内测 | 3–5 周 | 从任意 App 分享速记；断网恢复无重复；Play 内测通过 |
| **M3 iOS** | 复用 macOS 内核 + Share Extension + App Intents + Widget + TestFlight | 2–3 周 | 分享扩展可用；Siri 可速记；TestFlight 外部测试 |
| **M4 Windows** | 复用 Android + `desktop-integration`（Nucleus 或 JNA）+ MSI（**本地 Windows 虚拟机打包**）+ 自建更新 | 3–4 周 | 虚拟机里 MSI 安装/升级跑通；IME 验收（中英混切/候选框/150% 缩放）；无 SmartScreen 红警（或已知豁免） |

合计约 **15–21 周**到四端可用（M0 因三项新决定从 2 周变成 3 周）。**M1 之前必须完成**：Xcode 安装、Apple Developer 账号、AGPL §7 例外条款、demo 实例与演示账号、Windows 虚拟机。

---

## 9. 风险登记

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | Windows IME / DPI / 字体 | 中文用户无法输入 | M4 之前先做 spike；真机验收清单化 |
| R2 | Windows 签名拿不到（中国个人） | 安装红警、渠道受限 | 接受红警 / OV 证书 / 走开源分发不签名；**本地虚拟机只解决构建与联调，不解决证书** |
| R3 | AGPL 与 App Store 冲突 | iOS 无法上架 | 加 §7 additional permission（M1 前） |
| R4 | 搜索语义漂移 | 用户认为「搜不到」 | §7.4 三条验收 + 两端同一份查询语法 |
| R5 | 依赖许可证 | 发布链路重做 | D7 白名单 + 每次新增依赖过 SPDX |
| R6 | Xcode 27 项目格式锁定 | 团队机器版本不齐 | 统一 Xcode ≥27.2；回退 XcodeGen |
| R7 | CMP / Gradle 大版本变更 | 构建断裂 | 锁版本；CMP 1.13 与 AGP 10 等稳定后再评 |
| R8 | 两栈契约漂移 | 行为不一致 | 契约只从 OpenAPI 生成；契约覆盖测试 |
| R9 | 验证矩阵膨胀 | 每功能目检成本高 | 固定「5 屏 × zh/en × 明暗」矩阵；RTL 后置 |
| R10 | Web 端功能继续增长 | 原生端追不上 | 明确原生端不做 parity；每季度评审一次要不要补功能 |
| R11 | R2 签名直传暴露写入口 | 越权上传、存储滥用 | URL 10 分钟过期 + 绑定单对象 + 大小/类型白名单；未 complete 的对象由附件 GC 清理 |
| R12 | `sync_changes` 写放大与裁剪窗口 | 同步漏记录 / 表增长 | 30 天裁剪与回收站对齐；410 触发全量重建；cron 逐 pass 隔离 |
| R13 | Windows 虚拟机是 ARM，x64 产物仍需 x64 JDK 或 CI | 发布包架构不对 | 虚拟机内装 x64 JDK，或最终交给 `windows-latest`；打包前校验 arch |

---

## 10. 明确不做（v1）

- 富文本 WYSIWYG 编辑器（两端都只做 Markdown + 行内样式）。
- 插件沙箱分享卡（原生端无 iframe；如要分享图，后续做原生模板）。
- 团队空间、评论、admin、席位。
- 8 语言全量、阿拉伯语 RTL（P2）。
- 流式语音转写（v1 用批量转写）。
- Live Activity、Windows Store/MSIX、Mac App Store。
- iPad 专属布局。

---

## 11. 平台验收清单（真机，各端通用）

1. 冷启动到可输入 < 1s（M1/M2 目标，用 Instruments / Macrobenchmark 测）。
2. 飞行模式：打开、翻历史、写 10 条、带 1 图 → 恢复网络后服务端恰好 10 条、图已上传。
3. 中文两字/三字/混排搜索各一条正向用例 + 一条「搜不到」的负向用例。
4. 断网 → 联网 → 断网，重复 3 次，无重复记录、无幽灵记录。
5. 从系统入口速记（macOS ⌘⇧Space / Android 分享 / iOS 分享扩展）→ 3 秒内完成一条。
6. 深浅色切换无闪烁；CJK 与拉丁混排字距正常。
7. 1000 条时间线滚动不掉帧（60fps 基准，ProMotion 设备 120fps 不强求）。

---

## 12. 参考

- Xcode 27.2 系统要求：https://developer.apple.com/xcode/system-requirements
- Xcode 项目格式（JSON）：https://developer.apple.com/documentation/xcode/updating-your-xcode-project-configuration-file-format
- GRDB 7.12：https://github.com/groue/GRDB.swift/releases/tag/v7.12.0
- swift-openapi-generator：https://github.com/apple/swift-openapi-generator/releases/tag/1.14.4
- swift-markdown：https://github.com/swiftlang/swift-markdown/releases/tag/0.9.0
- Sparkle 2.10.1：https://github.com/sparkle-project/Sparkle/releases/tag/2.10.1
- KeyboardShortcuts 3.1.0：https://github.com/sindresorhus/KeyboardShortcuts/releases/tag/3.1.0
- swift-snapshot-testing：https://github.com/pointfreeco/swift-snapshot-testing/releases/tag/1.19.7
- Compose Multiplatform 兼容矩阵：https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html
- Kotlin releases：https://kotlinlang.org/docs/releases.html
- Play targetSdk 要求：https://developer.android.com/google/play/requirements/target-sdk
- App Store 审核指南（4.2 / 2.5.2）：https://developer.apple.com/app-store/review/guidelines/
- WKWebView 无 Service Worker（外壳方案为何被否）：https://developer.apple.com/forums/thread/773539
- AGPL §7 应用商店例外实例：https://github.com/zodl-inc/slipstream/blob/main/LICENSE-EXCEPTIONS.md
