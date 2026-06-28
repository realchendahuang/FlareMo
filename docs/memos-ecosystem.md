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
| 未测 | 只完成资料收集，还没有实际连接 FlareMo。 |
| 可用 | 已连接 FlareMo 并完成核心读写路径。 |
| 部分可用 | 核心路径有一部分可用，但存在明确缺口。 |
| 不支持 | 当前客户端能力或认证模型与 FlareMo 不匹配。 |

## 客户端和工具矩阵

| 工具 | 类型 | 仓库 | 是否支持自定义 header | 是否可走 Access Service Token | 当前状态 | 阻塞点 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| memos-desktop | 桌面客户端 | https://github.com/xudaolong/memos-desktop | 未确认 | 未确认 | 未测 | 验证是否能配置 API base URL 和自定义 Access headers。 |
| memos_wmp | 微信小程序 | https://github.com/Rabithua/memos_wmp | 未确认 | 未确认 | 未测 | 验证小程序网络层是否允许添加 Access headers。 |
| memoflow | 移动端客户端 | https://github.com/hzc073/memoflow | 未确认 | 未确认 | 未测 | 验证登录模型、API base URL、memo CRUD 和附件路径。 |
| telegramMemoBot | Telegram bot | https://github.com/qazxcdswe123/telegramMemoBot | 未确认 | 未确认 | 未测 | 验证 bot 是否依赖 Memos PAT，能否改用 Access headers。 |
| Dynos | 移动端客户端 | https://github.com/HonKLam/Dynos | 未确认 | 未确认 | 未测 | 验证离线同步和 FlareMo API 子集的重叠范围。 |
| mcp-server-memos | MCP server | https://github.com/LeslieLeung/mcp-server-memos | 未确认 | 未确认 | 未测 | FlareMo 自带 MCP endpoint；仍可验证外部 MCP server 是否能作为兼容客户端使用。 |
| memos-raycast | Raycast extension | https://github.com/JakeLaoyu/memos-raycast | 未确认 | 未确认 | 未测 | 验证 Raycast preferences 是否能配置 Access headers。 |
| memos-extensions | 浏览器插件 | https://github.com/yozi9257/memos-extensions | 未确认 | 未确认 | 未测 | 验证扩展权限、header 注入和创建 memo 路径。 |
| notum | 离线优先笔记 | https://github.com/nikita-popov/notum | 未确认 | 未确认 | 未测 | 验证同步协议是否只依赖 FlareMo 已支持的 `/api/v1` 子集。 |

## 验证标准

一个客户端标记为“可用”前，至少要完成：

- 配置 FlareMo base URL。
- 通过 Cloudflare Access Service Token 访问受保护实例，或明确记录只能访问本地/未保护实例。
- 创建 memo。
- 列出 memo。
- 编辑 memo。
- 删除或归档 memo。
- 如果客户端支持附件，验证上传和下载。
- 记录测试版本、FlareMo release、部署方式和已知缺口。

## 当前自动化覆盖

仓库里的 Memos 兼容测试覆盖 FlareMo 自己的 API contract：

- `packages/memos/src/adapter.test.ts`
- `apps/worker/src/memos-compatibility.test.ts`
- `apps/worker/src/api.test.ts`

这些测试证明 FlareMo 的公开子集稳定，但不能替代真实客户端兼容测试。真实客户端结果必须回写到本文。
