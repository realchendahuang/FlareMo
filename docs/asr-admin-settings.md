# 语音识别配置管理（ASR Admin Settings）— 需求与实施文档

> **v0.24.0 起**：独立的 `/capture` 录音页已删除，语音输入只保留在输入框的麦克风按钮里；本文描述的 Worker 桥接、服务商适配与限额不变，页面相关段落仅作历史记录。

> 状态（2026-09-16）：本需求已通过外部贡献 PR #135（edison-land）+ 维护者整合落地。实现与本决策稿有四处偏差，均为有意收敛，详见文末「PR #135 整合结论」。运行时设计文档见 [voice-settings.md](./voice-settings.md)，以下保留原始决策稿作为依据记录。

本文是「在管理 UI 上配置语音识别（ASR）凭证」的需求定义与实施规格。决策依据已锁定，实施按此执行；范围裁剪和后续演进见文末。

背景：PR #131 交付的 `/capture` 语音记录依赖部署者在后台预配 `FLAREMO_ASR_*` 环境变量，侧边栏入口才可见。对自部署用户而言，为启用一个产品功能去 wrangler 控制台配 5 个变量，门槛过高且不可发现。本文将其改为 owner 可在 UI 上完成的配置，环境变量保留为逃生通道。

## 最佳实践调研结论

以下外部依据支撑本文的关键决策（核对于 2026-09-15）：

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)：密钥生命周期（存储、访问控制、轮换）要集中管理，禁止写入日志与客户端可见面；存储密钥必须与访问控制配套，而非单纯依赖加密。
- [Stripe 密钥管理实践](https://docs.stripe.com/keys-best-practices)：密钥是凭据；展示一律掩码化（只露尾部），不可回查明文，更新即轮换。
- [Cloudflare D1 Data Security](https://developers.cloudflare.com/d1/reference/data-security/)：D1 全部对象静态加密（encryption at rest 默认开启）。因此在 D1 存第三方 Key 的增量风险是「同账号越权读 DB」，而非「磁盘泄露」。
- [The Twelve-Factor App — Config](https://12factor.net/config)：环境变量是部署级配置的规范载体；运行时可变配置与部署时配置并存时，需明确声明优先级，避免「配了不生效」的玄学。
- 业界 UI 形态参照（Ghost/WordPress/SaaS 后台通行做法）：密钥字段 write-only——保存后永不回显完整值，回显仅掩码尾 4 位；「留空 = 保持不变」是历史最久、最少踩坑的更新语义。

三个结论性取舍：

1. **存 D1、不做应用层加密**。不引入 Secrets Store/信封加密：需要额外付费绑定或一个「丢了就全作废」的主密钥，且自部署场景下 D1 与 wrangler secrets 同属一个 Cloudflare 账号，威胁模型没有实质变化。D1 静态加密 + 行级访问控制已覆盖实际风险。
2. **环境变量 > D1 配置**。已有部署（含 kosx）零迁移、行为不变；同时避免 UI 误操作把一个外部管理的 secret 静默降级为 DB 存储。两者并存时 UI 必须明示当前生效来源，不允许含糊。
3. **只做格式校验，不发起付费探测**。与现有 capture 设计哲学一致（status 只查本地配置、不打上游）；连通性问题留给首次录音时的可重试失败路径。

## 需求

### 用户故事

- 作为实例 owner，我在 Web 管理界面选择语音识别服务商、填写密钥并保存，保存后侧边栏「语音记录」入口立即出现，无需接触 wrangler 控制台。
- 作为实例 owner，我能看到当前配置是否生效、由哪一层（环境变量/已保存/未配置）提供，不会在两个配置源之间困惑。
- 作为实例 owner，我填过的密钥不会被任何人（包括我自己）通过界面回查明文；想换就整格重填。
- 团队 admin 与普通成员看不到也改不了这份配置（密钥是账单级凭据）。

### 验收标准

1. 未配置任何一层时，`GET /api/app/admin/asr` 返回 `source: "none"`，capture status `available: false`，侧边栏无入口。
2. 仅 UI 保存配置后（无需重新部署），capture status `available: true`，新开的 `/capture` 会话可用新配置完成录音保存。
3. 环境变量已配置时，UI 展示 env 来源与掩码值且编辑区置灰并附说明；`PUT /api/app/admin/asr` 仍可保存 D1 副本（作为 env 移除后的接管值），但不改变当前生效结果。
4. 任何 GET 响应中密钥字段只出现掩码（如 `sk-****7f2a`），完整明文不出现在任何响应、日志或导出物中。
5. 非 owner 调用 `PUT /admin/asr` 得到 403；团队 admin 不可见该配置入口。
6. 保存不满足格式校验的配置被 400 拒绝并给出字段级错误；已保存的配置永远是合法组合。
7. 支持显式停用：provider 置 `none` 后入口消失、capture 拒绝升级，无需清空已存密钥。
8. 中英日三语文案齐全；用户可见文案不出现 Memos 品牌名。

## 技术设计

### 配置解析与优先级

合并顺序：`env（FLAREMO_ASR_*）> D1 settings > 未配置`。env 任一关键存在即整体接管（不逐字段混拼，避免两半配置拼出怪物）。

新增 worker 侧纯函数（建议落 `apps/worker/src/asr/config.ts`）：

```ts
type AsrConfigSource = "env" | "db" | "none";
type AsrConfigValues = {
  provider: "dashscope" | "tencent" | "none";
  model?: string;
  dashscopeApiKey?: string;
  tencentAppId?: string;
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentHotwordId?: string;
  tencentHotwordList?: string;
};

// 读合并结果：env 存在则 env，否则读 D1 owner KV（key: "flaremo.instance.ASR"）
// 返回 { source, values | null }
export async function resolveAsrConfig(env, db): Promise<...>;
```

`getConfiguredAsr(env)` 保持现签名不动；把其内部的 readiness/normalize 逻辑（含 hotword 校验规则）提为纯函数，供「保存时校验」与「运行时 readiness」共用，避免两处规则漂移。腾讯云字段缺失、未知 provider、hotword 非法等判定规则不变。

存储复用 `settings` 表（owner 行级 KV，`getStoredSetting/upsertStoredSetting`），不新增表和迁移。语义对齐注册开关的先例（owner 名下、JSON value）。

### API 契约

挂在现有 `adminApi`（`/api/app/admin`，owner-only）：

`GET /api/app/admin/asr`

```jsonc
{
  "source": "env" | "db" | "none",
  "configured": true,
  "provider": "dashscope",
  "model": "fun-asr-realtime",        // 非密字段明文回显
  "dashscope_api_key": "sk-****7f2a", // 密钥字段仅掩码
  "tencent_app_id": "1234567890",     // AppID 为标识符，明文回显
  "tencent_secret_id": "****x9Kq",    // 含 Secret 字样的字段一律掩码
  "tencent_secret_key": "****",
  "tencent_hotword_id": "1000001",
  "tencent_hotword_list": "……"        // 非密，明文
}
```

掩码规则：值非空时统一为 `前 3 位（若整体形如带前缀的标识符）+ **** + 尾 4 位`，总长 < 8 则只回 `****`。掩码一律服务端计算，客户端永不持有明文。

`PUT /api/app/admin/asr`（body 同字段）

- 更新语义（write-only 标准）：**缺省 = 保留现值；`null` = 清除该字段；非空字符串 = 设置**。这一语义配合掩码回显，用户无需看到明文即可局部更新。
- 保存时按 resolve 后的 `values` 做 readiness 校验（纯函数），非法组合整单 400，字段级错误信息。校验通过才落库。
- `provider: "none"` 表示显式停用，其余字段保留。
- 成功返回与 GET 同构的最新状态。
- 生效即时：`getConfiguredAsr` 每请求现算，status 端点本就 `Cache-Control: no-store`；配置变更后新 WS 连接即用新配置，进行中的旧会话按连接时配置走完，不做热切换。

`capture-api.ts` 的 `/status` 改为基于 `resolveAsrConfig` 判定（原来只看 env）；对外契约不变（`available`/`provider`/`streaming`），provider 名本就对外暴露，不新增泄露面。

### UI

- 位置：account 页新增 tab「语音识别」（`auth.tab.asr`），门禁与品牌 tab 相同（`meQuery.data?.is_instance_owner`），排在品牌与 admin 之间。
- 卡片形态与 `BrandingCard` 一致：常态展示生效来源徽章（环境变量接管 / 已保存生效 / 未配置）、provider、非密字段、密钥掩码；env 接管时编辑区置灰并提示「当前由环境变量提供，此处保存的配置将在移除环境变量后生效」。
- 「编辑」弹窗：provider 下拉（Dashscope / 腾讯云 / 不启用）+ 对应字段组（model、密钥、腾讯 AppID/热词），密钥字段为 password 型输入，placeholder 展示当前掩码。
- 空态引导文案明示因果：「填写服务商密钥并保存后，侧边栏会出现『语音记录』入口」。这直接回应部署者最常见的困惑（配了 Key 却看不到入口）。
- i18n：`admin.asr.*` 键加入 `zh-CN / en-US / ja` 三个 message 文件；遵守文案卫生标准。

### 安全设计

- 写权限复用 `ownerContext`（`isInstanceOwner`），与品牌、成员管理同层；admin 页现有 UI 门禁不覆盖此 tab。
- 密钥永不进入：响应明文、Worker 日志（现有 provider 错误路径已只落安全类别，保持）、导出包（settings 表不在 memo 导出范围，实施时复核确认）、客户端持久化。
- Provider 协议已有约定：凭证只存在于 Worker→上游签名路径，从不反射到浏览器；本改动不触碰该边界。
- D1 Time Travel 备份会包含该行：接受（同账号、静态加密、与 wrangler secrets 同属一个账号风险面）；文档化即可，不做应用层加密。
- 轮换路径 = 重新保存新值；不做计划轮换、不做使用审计（无此威胁模型）。

## 实施步骤

改动按依赖序，全部在现有模式内，无新表、无新 binding、无迁移：

1. `apps/worker/src/asr/`：把 `provider.ts` 的 readiness/normalize 提为纯函数；新增 `config.ts`（`resolveAsrConfig` + D1 读写 + 掩码 + 校验）。
2. `apps/worker/src/routes/admin-api.ts`：新增 `GET/PUT /asr`，schema 校验 + `ownerContext`。
3. `apps/worker/src/routes/capture-api.ts`：`/status` 改用 `resolveAsrConfig`。
4. `apps/web/src/api.ts`：`getAsrConfig / updateAsrConfig`。
5. `apps/web/src/pages/admin-page.tsx`：`AsrCard`（对齐 `BrandingCard` 的卡片/弹窗/写路径模式），account 页加 tab。
6. i18n 三个 message 文件加 `admin.asr.*` / `auth.tab.asr`。
7. 测试：domain 侧校验纯函数单测（含 hotword 规则矩阵）、worker 路由测试（owner-only 403、掩码断言、env 优先、`null`/缺省语义、`none` 停用、status 翻转）、e2e 走「保存 → status available → 入口出现」主链路。
8. 门禁全跑 + format 先过；部署 kosx 验证真机流程（保存后入口出现 → 录音 → 保存成功）。

工作量量级与 BrandingCard 那批相当：约一天内含测试与门禁。

## 明确不做

- 不做付费连通性探测（保持「配置就绪 ≠ 上游可用」语义）。
- 不做按用户级开关/配额（capture 已有 per-user、per-IP 限流兜底）。
- 不做 Secrets Store 集成、应用层信封加密。
- 不做密钥使用审计与自动轮换。
- 本期不做「配置后自动生成入门引导」之类的运营化功能。

## 后续演进（记录方向，不承诺）

- 多 provider 并存与按质量自动选择（现合同单 provider，升级点在 `resolveAsrConfig` 返回结构，不破坏现有契约）。
-用量视图：按用户聚合 capture 会话数，给 owner 看账单归因。
- 若 SaaS 版出现多租户自配 Key 的需求，再评估 per-owner 密钥 + 信封加密，本期拒绝。

## PR #135 整合结论（2026-09-16 落地）

外部贡献者 edison-land 按同一需求独立实现了完整方案（PR #135），质量很高，经维护者整合后并入 main。与本文原稿的四处偏差及理由：

1. **专用表 `voice_service_config` 取代 settings 表 owner KV**，并引入 revision 乐观锁（两处编辑互不覆盖）与删除墓碑（防旧配置复活）。比原稿更严谨，采纳。
2. **可选加密信封取代「不做应用层加密」**：设了 ≥32 字符的 `FLAREMO_VOICE_CONFIG_KEY` 即 AES-GCM（AAD 绑定、新 nonce）；未设时以 v0 明文信封落库（D1 静态加密兜底），UI 提示但不阻塞。加密从硬门槛改为可选升级路径，采纳。原文「不做信封加密」作废。
3. **连接测试保留**：复用 capture 限流桶、8 秒超时、仅握手不发音频、不出上游错误原文。原稿「不做付费探测」过于保守，作废。
4. **掩码回显与 source 标识按本文执行**：GET 返回密钥字段尾 4 位掩码 + `source`（environment/database/none），env 接管时 UI 明示并置灰；恢复 capture status 的 provider 回显。

维持本文的关键决策：**环境变量 > D1**（PR 原稿删除 env 回退是破坏性变更，整合时恢复）；**owner-only**（PR 原稿放宽到 admin，与品牌卡权限阶梯倒挂，整合时收紧）。「留空 = 保留现值」语义由 PR 实现为同 provider 下空字段继承旧值，等价采纳。
