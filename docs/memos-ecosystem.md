# Memos 生态兼容记录

FlareMo 的目标是复用 Memos 生态，但兼容必须被验证。这个文档记录第三方客户端、脚本和工具对 FlareMo 的真实可用性，不把“接口长得像”当成“已经兼容”。

生产实例默认放在 Cloudflare Access 后面。第三方工具如果要直接访问受保护的 FlareMo，必须能发送：

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

不能发送自定义 header 的工具，可能只能用于未启用 Access 的本地实例、测试实例，或需要额外代理层。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 可用 | 已连接 FlareMo 并完成核心读写路径。 |
| 部分可用 | 核心路径有一部分可用，但存在明确缺口。 |
| 不支持 | 当前客户端能力或认证模型与 FlareMo 不匹配。 |
| 未测 | 只完成资料收集，还没有实际连接 FlareMo。 |

## 已验证工具和脚本

这些条目已经由仓库自动化测试覆盖，可以作为脚本和工具接入 FlareMo 的当前事实基线。

| 工具 / 路径 | 类型 | 测试版本 | 请求路径 | 是否需要 Access Service Token | 当前状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| curl / HTTP script | 通用脚本 | FlareMo `0.1.4` | `/api/v1/memos`、`/api/v1/attachments`、`/api/v1/export`、`/api/v1/import` | 生产 Access 后面需要 | 可用 | `apps/worker/src/api.test.ts` 覆盖 memo CRUD、分页、附件、分享、export/import。 |
| OpenAPI consumers | API schema 工具 | FlareMo `0.1.4` | `/openapi.json` | 生产 Access 后面需要 | 可用 | `apps/worker/src/memos-compatibility.test.ts` 断言公开路径写入 OpenAPI。 |
| FlareMo MCP endpoint | MCP 客户端 | FlareMo `0.1.4` | `/api/v1/mcp` | 生产 Access 后面需要 | 可用 | `apps/worker/src/api.test.ts` 调用 `tools/list` 并断言 `create_memo`。 |
| Public share reader | 浏览器 / curl | FlareMo `0.1.4` | `/share/*`、`/api/public/shares/*` | 不需要，需 Access bypass | 可用 | `apps/worker/src/api.test.ts` 和 `apps/worker/src/memos-compatibility.test.ts` 覆盖 public share token 隔离。 |

## 第三方客户端待测矩阵

这些条目还没有实际连接 FlareMo，不能写成支持。

| 工具 | 类型 | 仓库 | 待测版本 | 是否支持自定义 header | 是否可走 Access Service Token | 当前状态 | 需要验证的请求路径 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| memos-desktop | 桌面客户端 | https://github.com/xudaolong/memos-desktop | 待测 | 未确认 | 未确认 | 未测 | 验证 API base URL、自定义 Access headers、memo CRUD。 |
| memos_wmp | 微信小程序 | https://github.com/Rabithua/memos_wmp | 待测 | 未确认 | 未确认 | 未测 | 验证小程序网络层是否允许添加 Access headers。 |
| memoflow | 移动端客户端 | https://github.com/hzc073/memoflow | 待测 | 未确认 | 未确认 | 未测 | 验证登录模型、API base URL、memo CRUD 和附件路径。 |
| telegramMemoBot | Telegram bot | https://github.com/qazxcdswe123/telegramMemoBot | 待测 | 未确认 | 未确认 | 未测 | 验证 bot 是否依赖 Memos PAT，能否改用 Access headers。 |
| Dynos | 移动端客户端 | https://github.com/HonKLam/Dynos | 待测 | 未确认 | 未确认 | 未测 | 验证离线同步和 FlareMo API 子集的重叠范围。 |
| mcp-server-memos | MCP server | https://github.com/LeslieLeung/mcp-server-memos | 待测 | 未确认 | 未确认 | 未测 | FlareMo 自带 MCP endpoint；仍可验证外部 MCP server 是否能作为兼容客户端使用。 |
| memos-raycast | Raycast extension | https://github.com/JakeLaoyu/memos-raycast | 待测 | 未确认 | 未确认 | 未测 | 验证 Raycast preferences 是否能配置 Access headers。 |
| memos-extensions | 浏览器插件 | https://github.com/yozi9257/memos-extensions | 待测 | 未确认 | 未确认 | 未测 | 验证扩展权限、header 注入和创建 memo 路径。 |
| notum | 离线优先笔记 | https://github.com/nikita-popov/notum | 待测 | 未确认 | 未确认 | 未测 | 验证同步协议是否只依赖 FlareMo 已支持的 `/api/v1` 子集。 |

## 验证标准

一个客户端标记为“可用”前，至少要完成：

- 配置 FlareMo base URL。
- 通过 Cloudflare Access Service Token 访问受保护实例，或明确记录只能访问本地/未保护实例。
- 记录客户端名称、版本、测试日期、FlareMo version 或 commit。
- 创建 memo。
- 列出 memo。
- 编辑 memo。
- 删除或归档 memo。
- 如果客户端支持附件，验证上传和下载。
- 如果客户端支持分享，验证创建分享和公开读取。
- 记录部署方式、已知缺口和是否需要代理层。

## 记录模板

```markdown
### <client name>

- 客户端版本：
- FlareMo version / commit：
- 部署方式：local / protected production / unprotected test
- Access Service Token：required / not required / unsupported
- 请求路径：
- 结果：可用 / 部分可用 / 不支持
- 已验证：
  - create memo:
  - list memo:
  - edit memo:
  - archive/delete memo:
  - attachment:
  - share:
- 缺口：
```

## 当前自动化覆盖

仓库里的 Memos 兼容测试覆盖 FlareMo 自己的 API contract：

- `packages/memos/src/adapter.test.ts`
- `apps/worker/src/memos-compatibility.test.ts`
- `apps/worker/src/api.test.ts`

这些测试证明 FlareMo 的公开子集稳定，但不能替代真实客户端兼容测试。真实客户端结果必须回写到本文。
