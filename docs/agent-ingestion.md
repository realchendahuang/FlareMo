# Agent 与 IM 渠道写入

FlareMo 的私有 API 始终需要 Better Auth 应用层凭据：浏览器使用 HttpOnly cookie session，外部 Agent、自动化脚本和 IM Bot 使用可撤销的 `memos_pat_` Personal Access Token。Cloudflare Access 是可选的外层 policy；生产仍启用 Access 时，再附加 Access Service Token。Access Service Token 单独不能成为 FlareMo 用户身份。

## Agent 直接提交

先在 FlareMo Web 界面创建一个有明确用途和过期时间的 `memos_pat_` PAT。若目标部署仍启用 Cloudflare Access，再按 [部署指南](./deploy.md#3-创建-service-token) 创建 Access Service Token，然后：

```bash
curl -X POST "$FLAREMO_URL/api/v1/memos" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  -H "Content-Type: application/json" \
  --data '{
    "content": "文章摘要与原始链接 #inbox",
    "visibility": "private",
    "source": "agent",
    "payload": {
      "tags": ["inbox"],
      "client_id": "agent:source-message-id"
    }
  }'
```

如果目标入口仍启用 Cloudflare Access，在同一个请求中再追加：

```bash
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

写入成功后，该 memo 会直接出现在 Web 时间线。`source` 用于标记渠道；`payload.client_id` 建议保存渠道侧消息 ID，方便排查重试。当前 API 不把它当成唯一键，调用方仍应避免重复投递。

需要工具发现能力时，可以连接 `/api/v1/mcp`，使用 `create_memo`、`list_memos`、`get_memo` 和 `search_memos`。

## Telegram Bot 示例

仓库中的 `apps/telegram-bot` 是一个独立 Cloudflare Worker 示例。它会：

1. 校验 Telegram `secret_token` header；
2. 只接受 `TELEGRAM_ALLOWED_CHAT_IDS` 白名单中的会话；
3. 将文本、图片 caption 或转发内容写入 FlareMo；
4. 使用 `FLAREMO_MEMOS_PAT` 通过 FlareMo 应用层认证；
5. 如果启用了生产 Access，则额外使用 Access Service Token 穿过外层边界；
6. 为 memo 添加 `telegram` 标签和来源元数据。

配置公开变量：

```bash
cd apps/telegram-bot
pnpm exec wrangler deploy --config wrangler.jsonc
```

真实的 FlareMo HTTPS origin 和 chat id 写入 `wrangler.jsonc`，Worker 会拒绝 HTTP、带路径、query 或 fragment 的目标 URL。敏感值必须通过 secret 写入，不得提交：

```bash
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_MEMOS_PAT --config wrangler.jsonc
```

如果 FlareMo 的生产入口仍由 Cloudflare Access 保护，再配置成对的 Access Service Token secrets；两项必须同时存在：

```bash
pnpm exec wrangler secret put FLAREMO_ACCESS_CLIENT_ID --config wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_ACCESS_CLIENT_SECRET --config wrangler.jsonc
```

注册 Telegram webhook：

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://flaremo-telegram-bot.<account>.workers.dev/" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

`TELEGRAM_BOT_TOKEN` 只用于调用 Telegram 的 `setWebhook`，不需要存进 Worker。Telegram 的 webhook secret、FlareMo PAT 与 Cloudflare Access Service Token 是不同边界，不能互相替代；PAT 不能写进 `wrangler.jsonc`、Git 或日志。撤销或轮换 PAT 时，也要同步更新 Telegram Worker secret。

## 飞书、Discord 和 Slack

其他渠道沿用同一模式：渠道 webhook Worker 负责验签、白名单、格式转换和重试控制；FlareMo 只接收标准 memo DTO。不要把每个平台的签名协议和密钥塞进 FlareMo 主 Worker。

AI 摘要、正文抓取和标签提取属于可选派生步骤。即使模型失败，也应该允许保存原始文本或链接；AI 返回内容不得绕过 Access，也不得成为 D1 之外的权威数据源。
