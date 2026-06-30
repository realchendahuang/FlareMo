# FlareMo 技术栈

这份文档定义 FlareMo 当前已经确定的技术栈。它不是决策日志，也不是过程记录。后续如果技术栈发生变化，直接修改本文原文，不追加时间线。

## 架构原则

FlareMo 对外提供 Memos 兼容 API，但内部实现是 FlareMo-native 和 Cloudflare-native。

- 对外兼容 Memos 客户端、脚本、导入导出、OpenAPI 和 MCP。
- 对内模型、存储和服务层保持干净、克制，并围绕 Cloudflare Workers 的运行时约束设计。
- 不复制 Memos 的服务端架构。Memos 的 Go server、多数据库抽象、文件系统假设、实例管理后台、社交功能和常驻进程模型都是参考材料，不是 FlareMo 的实现目标。

## 核心技术栈

| 层级 | 选择 | 作用 |
| --- | --- | --- |
| 语言 | TypeScript | Worker、contracts、domain logic 和 frontend 共用一套语言。 |
| 运行时 | Cloudflare Workers | 运行 API，并通过 Workers Static Assets 托管 Web 应用。 |
| 构建 | Vite | 前端和 Worker 友好的构建管线。 |
| API 框架 | Hono | 适合 Workers 的轻量路由和中间件。 |
| 数据库 | Cloudflare D1 | 笔记、用户、设置、关系、分享、令牌和附件元数据的唯一事实源。 |
| ORM | Drizzle ORM | 数据库 schema 的事实源，提供类型安全查询和 migration 生成。 |
| 迁移 | drizzle-kit + Wrangler D1 migrations | Drizzle 生成 SQL，Wrangler 将 migration 应用到本地和远程 D1。 |
| 校验 | Zod + `drizzle-orm/zod` | API 运行时校验，以及从 Drizzle schema 派生 select / insert / update 校验规则。 |
| 前端 | React | 面向快速收集的 Web UI。 |
| 服务端状态 | TanStack Query | 请求、缓存、乐观更新和失效刷新。 |
| 前端路由 | TanStack Router | 类型安全的前端路由。 |
| UI | Tailwind CSS + shadcn/ui | 干净、可维护、适合工具型产品的组件基础。 |
| 访问控制 | Cloudflare Access | 保护生产 Worker、Preview URL 和自定义域；应用内不维护实例级访问令牌。 |
| 对象存储 | Cloudflare R2 | 存附件二进制、导出包、生成资源和音频文件。 |
| 工具链 | Wrangler | 本地开发、D1 migrations、bindings 和部署。 |
| 测试 | Vitest + Playwright | 单元/集成测试，以及浏览器级产品验证。 |

## 最佳实践判断

当前技术栈是 FlareMo 的最佳实践组合。

理由：

- Cloudflare 官方文档支持把静态资源和 Worker 代码作为一个整体部署。Workers Static Assets 可以把 HTML、CSS、图片等静态资源随 Worker 一起上传并由 Cloudflare 负责缓存和服务，官方 React SPA + API Worker 示例也使用 Cloudflare Vite plugin。
- Cloudflare Vite plugin 让 Worker 代码运行在 `workerd` 中，开发和预览环境更接近生产环境，适合 FlareMo 这种前端和 API 同仓开发的项目。
- D1 是 Cloudflare 的 serverless SQL 数据库，提供 SQLite 语义、Worker binding 和 migration 能力，适合做笔记、用户、分享、关系等结构化主数据的事实源。
- Drizzle 官方支持 Cloudflare D1 和 Workers 环境；Cloudflare D1 文档也把 Drizzle 作为社区 ORM 方案列出，并明确 drizzle-kit 可生成 D1 schema 和 SQL migrations。
- Drizzle 的 Zod schema generation 应使用当前官方文档里的 `drizzle-orm/zod`。旧的独立 `drizzle-zod` 不作为 FlareMo 新项目的固定技术栈入口。
- Hono 适合 Workers 运行时；`@hono/zod-openapi` 能把 Zod 校验和 OpenAPI 生成放在同一套 API contract 中，符合 FlareMo 对 Memos-compatible API、OpenAPI 和 MCP 的要求。
- TanStack Query 适合处理服务端状态、缓存、乐观更新和失效刷新，正好匹配笔记系统的快速创建、编辑、删除和列表刷新。
- TanStack Router 的类型安全路由和 search params 能力，适合搜索、标签、分页、排序等状态需要进 URL 的工具型产品。
- shadcn/ui 是可复制、可改造的组件基础，不是封闭 UI 框架，适合 FlareMo 后续形成自己的产品风格。
- Cloudflare Access 可以直接保护 Workers 的 `workers.dev`、Preview URL 和自定义域。FlareMo 不在应用层实现实例级访问令牌登录；人的访问交给 Access identity policy，脚本和 MCP 使用 Access Service Token。

这套栈不是为了“显得完整”而堆技术。稳定核心是：Workers + D1 + Drizzle + Hono + React。R2、Vectorize、Workers AI、Queues/Cron 都有明确职责，不能替代 D1 的主数据位置。

## 官方依据

这套技术栈以当前官方文档和上游文档为依据：

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)：静态资源可以和 Worker 一起上传，由 Cloudflare 负责缓存和服务。
- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)：Worker 代码在 `workerd` 中运行，开发环境更接近生产环境。
- [Cloudflare React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)：官方示例支持 React SPA、Workers API 和 Cloudflare Vite plugin 的全栈组合。
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)：D1 migration 以 SQL 文件形式版本化并由 Wrangler 应用。
- [Drizzle Cloudflare D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)：Drizzle 官方支持 D1 和 Cloudflare Workers 环境。
- [Drizzle Zod](https://orm.drizzle.team/docs/zod)：从 Drizzle schema 生成 Zod select / insert / update schemas。
- [Hono Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)：Hono 支持 Cloudflare Workers 和 Wrangler 开发发布路径。
- [Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi)：Zod 校验可以和 OpenAPI 生成放在同一套 API contract 中。
- [TanStack Query](https://tanstack.com/query/latest)：处理服务端状态、缓存、请求去重、mutation 和失效刷新。
- [TanStack Router](https://tanstack.com/router/latest)：提供类型安全路由和 search params 状态管理。
- [shadcn/ui](https://ui.shadcn.com/docs)：作为可复制、可改造的组件基础，不是封闭组件库。
- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev)：可以保护 `workers.dev` 和 Preview URL，并通过 Access policy 限制访问者。
- [Cloudflare Access Service Tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)：用于自动化脚本、MCP 和 Memos-compatible 客户端等非交互式访问。
- [Cloudflare R2](https://developers.cloudflare.com/r2/)：用于大体积非结构化对象。
- [Workers KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/)：适合高读、可缓存、最终一致的数据，不作为主数据库。
- [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/)：用于 embedding 和语义搜索索引，不作为权威业务数据源。

## 数据归属

D1 是唯一的主数据库。

FlareMo 的笔记是关系型业务数据。它需要创建后立即可读、更新、删除、分页、搜索过滤、标签、分享、导入导出、Memos 兼容资源映射和可持续 migration。这些数据必须放在 D1，并通过 Drizzle 建模。

R2 只存二进制对象。

R2 用来存不应该塞进关系型行里的数据：

- 图片附件
- 音频附件
- 导出包
- 生成的分享资源
- 大体积导入文件

向量库和 AI 知识库只存派生索引。

语义搜索数据必须引用 D1 记录，不能成为事实源：

- `memo_id`
- `chunk_id`
- embedding vector
- 少量检索元数据

语义搜索返回结果后，FlareMo 必须回 D1 读取权威 memo 数据。

语义搜索的完整边界见 [semantic-search.md](./semantic-search.md)。

KV 不属于核心数据库栈。

Workers KV 适合高读、最终一致的数据，比如缓存、feature flags 和低风险配置。它不能存 canonical notes、权限、分享状态、强一致 session 或 Memos 兼容业务数据。

## Cloudflare 产品边界

只使用当前产品表面真正需要的 Cloudflare 产品。

### 核心依赖

- Workers
- Workers Static Assets
- D1
- Cloudflare Access
- Wrangler
- R2

### 按职责使用

- KV：只用于缓存、feature flags、低风险配置等最终一致场景。
- Durable Objects：用于实时同步、协作、WebSocket、用户级协调或强一致限流。
- Queues / Cron：用于链接预览刷新、导出生成、embedding、清理、定期回顾等异步任务。
- Vectorize：用于语义搜索索引。
- Workers AI：用于 AI 标签、回顾、问答和 embedding 等 AI 能力。

FlareMo 首先是一个完整可靠的笔记和知识管理系统，不是 Cloudflare 全家桶展示项目。

## API 设计

FlareMo 有两层 API。

生产环境下，两层 API 都位于 Cloudflare Access 之后。FlareMo 业务代码只处理笔记领域逻辑，不实现实例级访问令牌、登录页或自建会话网关。

### Memos 兼容 API

`/api/v1/*` 是公开兼容层。

它服务于：

- Memos 兼容客户端
- 迁移和导入导出工具
- 脚本和自动化
- OpenAPI
- MCP

这一层在支持范围内保留 Memos 兼容的资源命名和响应字段。

脚本、MCP 和 Memos-compatible 客户端通过 Cloudflare Access Service
Token 调用这一层。客户端只发送 Cloudflare Access 要求的两个头：

```bash
CF-Access-Client-Id: <client id>
CF-Access-Client-Secret: <client secret>
```

FlareMo 不接受也不签发应用内 Bearer token。生产实例的正确做法是在
Cloudflare Access application 上增加 `non_identity` policy，并用
`service_token` selector 绑定允许访问的 Service Token。

公开分享路径是唯一例外。`/share/*`、`/api/public/shares/*` 和
`/assets/*` 用于 public share，生产 Access application 必须给这些路径
配置明确的 `bypass` policy。这个 bypass 只跳过 Cloudflare Access 登录
和静态资源保护，不跳过 FlareMo 的 share token 校验。公开分享内容由
share token、过期时间和 memo 状态控制；归档、回收站、删除或过期的分享
不会公开返回。

### FlareMo 原生 API

`/api/app/*` 服务 FlareMo 自己的前端。

它可以比兼容 API 更简单、更高效，但必须复用同一套 domain services 和 Drizzle-backed repositories。不能为两层 API 维护两套业务实现。

## 数据库设计

Drizzle schema 是数据库结构的事实源。

核心表从 FlareMo 自己的领域模型出发，同时保留到 Memos 兼容 DTO 的干净 adapter 路径：

- `users`
- `memos`
- `memo_relations`
- `attachments`
- `shares`
- `settings`

凡是需要独立查询、过滤或更新的业务字段，都应该放进列。JSON payload 只用于派生元数据或暂时不需要一等关系行为的灵活字段。

例子：

- `content`、`visibility`、`status`、`pinned`、`created_at`、`updated_at` 是列。
- `title`、`has_link`、`has_task_list`、`has_code`、`location` 这类计算属性，在需要专门索引之前可以放在 payload/property 结构里。
- 附件二进制永远不进 D1；D1 只存 R2 key 和元数据。

## Monorepo 结构

```text
apps/
  web/        # React + Vite 前端
  worker/     # Hono Worker API 和 static asset entry

packages/
  contracts/  # Zod schemas、OpenAPI generation、public DTOs
  db/         # Drizzle schema、D1 connection helpers、repositories
  domain/     # FlareMo 领域服务
  memos/      # Memos 兼容 API adapter 和 DTO mapping
  ui/         # 共享 UI 组件

migrations/   # drizzle-kit 生成、Wrangler 应用的 SQL migrations
docs/         # 结果型项目文档
```

## 实现规则

- 从第一天开始使用 Drizzle。不要把手写 SQL 当成常规数据访问层。
- D1 存 canonical notes 和业务状态。
- R2 存文件。
- Vectorize 或任何 AI 知识库只存派生搜索索引。
- KV 不是数据库替代品。
- Memos 兼容 API 是 FlareMo 内部服务之上的 adapter。
- 生产访问边界使用 Cloudflare Access；不要在应用内再造实例级访问令牌登录。
- 产品实现保持克制：围绕快速收集、时间线、搜索、标签、附件、导入导出、语义检索、AI 工作流和 Memos 兼容面展开，不做无关的社交和后台复杂度。
- 不为了凑技术栈而添加 Cloudflare 产品。功能真的需要时再引入。
