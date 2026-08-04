# Security Policy

## 支持版本

当前只支持最新 release。FlareMo 仍处于早期版本，安全修复会优先进入最新版本。

## 报告漏洞

请不要把未公开漏洞直接发到公开 issue。

可以通过 GitHub Security Advisory 报告，或联系维护者在 GitHub profile 中公开的联系方式。

报告时请包含：

- 影响版本或 commit。
- 部署方式。
- Better Auth 原生认证配置是否启用，以及 Cloudflare Access 外层是否启用。
- 复现步骤。
- 影响范围。
- 建议修复方式，如果有。

## 安全边界

- FlareMo 应用层使用 Better Auth。浏览器会话使用 `HttpOnly`、`SameSite=Lax` 的 cookie；认证身份与既有 FlareMo `users/owner` 通过专用映射表关联。
- 当前只开放一次性 owner bootstrap，不开放公共 signup。bootstrap 需要部署者配置的 `FLAREMO_BOOTSTRAP_SECRET`，成功后会被 D1 状态锁定；失败状态必须显式恢复，不能自动创建第二个 owner。
- 密码由 Better Auth 处理，当前要求长度为 12–128 个字符。初始密码只通过 bootstrap 请求提交，不写入代码、文档、migration、日志或聊天。
- 当前默认没有 email provider，因此“忘记密码”邮件流程保持关闭；已知当前密码时可通过 Better Auth 修改。已完成 bootstrap 的单用户实例可以在明确配置独立 `FLAREMO_RECOVERY_SECRET` 的短窗口内执行 break-glass recovery：它保留原 owner mapping、复用 Better Auth reset-password 流程、撤销所有 session 和 `memos_pat_`，成功后必须立即轮换或删除该 secret。
- 脚本、MCP 和 Memos-compatible 客户端使用由已登录浏览器账户创建的 `memos_pat_` Personal Access Token。PAT 只在创建响应中返回一次，D1 只保存不可逆校验值；账户页可以列出和撤销 PAT。
- Cloudflare Access 是可选的外层防线，生产迁移期建议保留。启用 Access 时，客户端必须同时通过 Access policy 和 FlareMo 应用层认证；Access Service Token 本身不等于 FlareMo 用户 session，也不能单独访问私有 API。
- 公开分享路径可以 bypass Access，但分享内容仍由 FlareMo 的 share token、过期时间和 memo 状态校验。公开分享不接受浏览器 session 或 PAT 作为分享授权的替代物。
- `BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和可选的 `FLAREMO_RECOVERY_SECRET` 不得放入 `wrangler.jsonc`、`.dev.vars.example` 的真实值、Git、issue、PR、日志或聊天；生产环境应使用 `wrangler secret put` 或 Cloudflare 控制台配置。

### Origin 与凭据类型

`FLAREMO_PUBLIC_URL` 和可选的 `FLAREMO_TRUSTED_ORIGINS` 组成应用层的精确 Origin allowlist。比较的是完整 origin（scheme、host 和 port），不支持 wildcard；`Referer`、Cloudflare Access headers 或其他代理头不能替代 `Origin`。

- 使用 cookie session 的状态变更请求，包括 `POST`、`PATCH`、`DELETE` 和其他非安全方法，必须携带 `Origin`，且必须精确匹配 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS` 中的一个值。Origin 缺失或不匹配时返回 `403`，不能通过只增加 Access headers 来绕过。
- PAT/Bearer 请求可以没有 `Origin`，这是桌面脚本、MCP 和其他非浏览器客户端的正常情况。如果 PAT 请求携带 `Origin`，它也必须精确匹配同一 allowlist；不匹配时返回 `403`。

这个 credential-specific 规则与 [Memos 0.30 MCP 文档](https://usememos.com/docs/integrations/mcp) 所描述的 browser-origin 防 DNS rebinding 模型保持同一安全方向：浏览器来源必须受信任，桌面客户端可以不发送 Origin。安全模型相似不代表协议已经兼容；当前 `/mcp` Streamable HTTP 和 current camelCase wire adapter 仍是 Issue [#40](https://github.com/realchendahuang/FlareMo/issues/40)，#39 不承诺完整 Memos Server parity。

## 认证边界与 Memos 兼容

`memos_pat_` 是 FlareMo 的应用层 PAT 前缀，不代表已经实现 Memos Server 的完整认证协议。#39 只建立了可保护 FlareMo 兼容 API 子集的 cookie/PAT 认证基础：

- 当前 FlareMo `/api/v1/*` 和旧式 `/api/v1/mcp` JSON-RPC 端点接受 `Authorization: Bearer memos_pat_...`。
- 当前 Memos 的完整 auth facade、字段/错误翻译、current camelCase wire adapter，以及 `/mcp` Streamable HTTP 端点仍属于 Issue #40。
- 兼容 API 的数据模型、字段命名、分页和行为只在 [Memos 兼容矩阵](./docs/memos-compatibility.md) 标记的子集内承诺。

## 不属于漏洞的情况

- 未配置 Cloudflare Access 本身不是应用层认证绕过；但部署者若没有配置 Better Auth 的公开 URL、应用 secret 和一次性 bootstrap secret，原生认证会 fail closed，实例也不应被宣称为可用。
- 公开分享 token 被主动分享后可访问。
- 本地开发环境 `.wrangler/` 或 `.dev.vars` 泄露；这些文件不应提交，但若真实凭据泄露仍应立即轮换。
