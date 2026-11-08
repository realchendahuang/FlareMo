// 本文件由 scripts/apple/gen-i18n.mjs 生成，请勿手改。
// 重新生成：node scripts/apple/gen-i18n.mjs（--check 只校验是否最新）
//
// 文案事实源：apps/web/src/i18n/messages/*.ts（8 个语言，zh-CN 是主目录）。
// v1 只生成 zh-Hans 与 en-US；ja/fr/es/ko/ru/ar 仍参与解析和 key 校验，但不生成常量
// （docs/native-clients.md §7.3，补齐语言的成本只是改生成脚本里的一行开关）。
//
// 命名规则（脚本里是同一套规则，改这里必须同步改 scripts/apple/gen-i18n.mjs）：
//   key 的点号路径 → 嵌套 enum + 属性：首段 PascalCase 成 enum 名，其余段拼接成属性名
//   （第二段原样、后续段首字母大写）：
//     nav.articles                → L10n.Nav.articles
//     connect.clientType.device   → L10n.Connect.clientTypeDevice
//   Swift 保留字加反引号：
//     common.import               → L10n.Common.`import`
//   带 {name} 插值的文案生成 func，参数一律 String（数字、日期由调用方按语言格式化）：
//     connect.lastUsed            → L10n.Connect.lastUsed(date: "3 月 4 日")
//
// 为什么不用 .xcstrings：SwiftPM 对 String Catalog 的资源打包支持不稳（尤其跨平台
// target），生成常量没有资源查找、key 拼错是编译错误。文案只在 UI 层（MainActor）使用，
// 所以本文件显式 @MainActor，不依赖 target 的默认隔离设置。
//
// 本次生成：1026 条文案 / 47 个组 / 66 个带插值的 func。
// 参与校验的语言：zh-Hans(1026)、en-US(1026)、ja(1026，仅校验)、fr(1026，仅校验)、es(1026，仅校验)、ko(1026，仅校验)、ru(1026，仅校验)、ar(1026，仅校验)。

import Foundation

/// 本地化文案入口。所有文案都在编译期确定：key 拼错是编译错误，不做运行时字符串查找，
/// 也不依赖 SPM 资源打包。事实源与生成规则见本文件头部。
public enum L10n {
    /// 生成时支持的语言（docs/native-clients.md §7.3：v1 只有简体中文与英文）。
    public enum SupportedLanguage: String, CaseIterable, Sendable, Hashable {
        case zhHans = "zh-Hans"
        case enUS = "en-US"

        /// 按系统首选语言解析：简体中文（含其它 zh 变体）→ zh-Hans，其余 → en-US。
        public static var system: SupportedLanguage { resolved(from: Locale.current) }

        /// 纯函数形式：方便单测，也方便 App 按自己的偏好解析后赋给 `L10n.language`。
        public static func resolved(from locale: Locale) -> SupportedLanguage {
            locale.language.languageCode?.identifier == "zh" ? .zhHans : .enUS
        }
    }

    /// 当前生效语言，默认跟随系统。
    ///
    /// App 若要支持「应用内切换语言」，在创建界面之前赋值一次即可；切换后需要重建视图树
    /// 才会生效（这里只负责取值，不负责通知刷新）。该属性 @MainActor，可变状态因此安全。
    @MainActor
    public static var language: SupportedLanguage = .system

    // MARK: - 文案组

    /// `account.*`：1 条文案。
    @MainActor
    public enum Account {
        /// `account.readerUntil`
        public static func readerUntil(date: String) -> String {
            fmPick("读者有效期至 \(date)", "Reader valid until \(date)")
        }
    }

    /// `admin.*`：136 条文案。
    @MainActor
    public enum Admin {
        /// `admin.activationDescription`
        public static var activationDescription: String { fmPick("成员创建后会获得一次性激活链接，并自行设置密码。", "The member will set their own password from a one-time activation link after creation.") }

        /// `admin.branding.accent`
        public static var brandingAccent: String { fmPick("主题色", "Accent color") }

        /// `admin.branding.accentCustom`
        public static var brandingAccentCustom: String { fmPick("自定义", "Custom") }

        /// `admin.branding.accentHex`
        public static var brandingAccentHex: String { fmPick("十六进制色值", "Hex color value") }

        /// `admin.branding.accentHexHint`
        public static var brandingAccentHexHint: String { fmPick("输入 6 位十六进制色值（如 #7c3aed）。", "Enter a 6-digit hex value, e.g. #7c3aed.") }

        /// `admin.branding.accentHint`
        public static var brandingAccentHint: String { fmPick("已全站实时应用并自动保存。", "Applied across the site instantly and saved automatically.") }

        /// `admin.branding.accentPick`
        public static var brandingAccentPick: String { fmPick("选取颜色", "Pick a color") }

        /// `admin.branding.accent_amber`
        public static var brandingAccent_amber: String { fmPick("琥珀", "Amber") }

        /// `admin.branding.accent_crimson`
        public static var brandingAccent_crimson: String { fmPick("绯红", "Crimson") }

        /// `admin.branding.accent_flame`
        public static var brandingAccent_flame: String { fmPick("火焰", "Flame") }

        /// `admin.branding.accent_indigo`
        public static var brandingAccent_indigo: String { fmPick("靛蓝", "Indigo") }

        /// `admin.branding.accent_iris`
        public static var brandingAccent_iris: String { fmPick("鸢尾", "Iris") }

        /// `admin.branding.accent_jade`
        public static var brandingAccent_jade: String { fmPick("翡翠", "Jade") }

        /// `admin.branding.accent_ocean`
        public static var brandingAccent_ocean: String { fmPick("海洋", "Ocean") }

        /// `admin.branding.accent_teal`
        public static var brandingAccent_teal: String { fmPick("湖水", "Teal") }

        /// `admin.branding.failed`
        public static var brandingFailed: String { fmPick("品牌设置保存失败。", "Failed to save branding.") }

        /// `admin.branding.favicon`
        public static var brandingFavicon: String { fmPick("站点图标（favicon）", "Site icon (favicon)") }

        /// `admin.branding.faviconRemoved`
        public static var brandingFaviconRemoved: String { fmPick("站点图标已移除。", "Site icon removed.") }

        /// `admin.branding.faviconUploaded`
        public static var brandingFaviconUploaded: String { fmPick("站点图标已更新。", "Site icon updated.") }

        /// `admin.branding.identity`
        public static var brandingIdentity: String { fmPick("Logo 与产品名", "Logo & product name") }

        /// `admin.branding.markDark`
        public static var brandingMarkDark: String { fmPick("Logo（深色模式，可选，未设置时复用浅色）", "Logo (dark mode, optional; falls back to the light mark)") }

        /// `admin.branding.markLight`
        public static var brandingMarkLight: String { fmPick("Logo（浅色模式）", "Logo (light mode)") }

        /// `admin.branding.markRemoved`
        public static var brandingMarkRemoved: String { fmPick("Logo 已移除。", "Logo removed.") }

        /// `admin.branding.markUploaded`
        public static var brandingMarkUploaded: String { fmPick("Logo 已更新。", "Logo updated.") }

        /// `admin.branding.productName`
        public static var brandingProductName: String { fmPick("产品名称", "Product name") }

        /// `admin.branding.productNamePlaceholder`
        public static var brandingProductNamePlaceholder: String { fmPick("默认 FlareMo", "Default: FlareMo") }

        /// `admin.branding.remove`
        public static var brandingRemove: String { fmPick("移除", "Remove") }

        /// `admin.branding.replace`
        public static var brandingReplace: String { fmPick("替换", "Replace") }

        /// `admin.branding.saved`
        public static var brandingSaved: String { fmPick("品牌设置已保存。", "Branding saved.") }

        /// `admin.branding.statusDefault`
        public static var brandingStatusDefault: String { fmPick("未自定义，使用 FlareMo 默认品牌", "Using the FlareMo default brand") }

        /// `admin.branding.title`
        public static var brandingTitle: String { fmPick("品牌外观", "Branding") }

        /// `admin.branding.upload`
        public static var brandingUpload: String { fmPick("上传 PNG / WebP / SVG", "Upload PNG / WebP / SVG") }

        /// `admin.clearFilters`
        public static var clearFilters: String { fmPick("清空筛选条件", "Clear filters") }

        /// `admin.copyResetLink`
        public static var copyResetLink: String { fmPick("复制链接", "Copy link") }

        /// `admin.createUser`
        public static var createUser: String { fmPick("添加成员", "Add member") }

        /// `admin.creatingUser`
        public static var creatingUser: String { fmPick("正在添加…", "Adding…") }

        /// `admin.daysLeft`
        public static func daysLeft(days: String) -> String {
            fmPick("剩 \(days) 天", "\(days)d left")
        }

        /// `admin.deleteConfirm`
        public static var deleteConfirm: String { fmPick("移出后，该成员将无法登录；仅自己可见的内容和个人数据会被删除，团队可见及全网公开的内容会保留。", "This member will lose access. Their private and personal data will be deleted; team and public content will be retained.") }

        /// `admin.deleteUser`
        public static var deleteUser: String { fmPick("移出团队", "Remove from team") }

        /// `admin.expired`
        public static var expired: String { fmPick("已过期", "Expired") }

        /// `admin.hideResetLink`
        public static var hideResetLink: String { fmPick("关闭并隐藏", "Hide link") }

        /// `admin.integrations.delete`
        public static var integrationsDelete: String { fmPick("删除配置", "Delete configuration") }

        /// `admin.integrations.deleted`
        public static var integrationsDeleted: String { fmPick("集成配置已删除。", "Integration configuration removed.") }

        /// `admin.integrations.emailApiKey`
        public static var integrationsEmailApiKey: String { fmPick("Resend API Key", "Resend API key") }

        /// `admin.integrations.emailCloudflareNote`
        public static var integrationsEmailCloudflareNote: String { fmPick("当前使用 Cloudflare Email 发信（环境变量 EMAIL binding），请在部署配置中修改，此处不可编辑。", "Currently sending through the Cloudflare EMAIL binding (environment); not editable here.") }

        /// `admin.integrations.emailConfigure`
        public static var integrationsEmailConfigure: String { fmPick("配置发信凭据", "Configure email credentials") }

        /// `admin.integrations.emailConfigured`
        public static func integrationsEmailConfigured(provider: String) -> String {
            fmPick("邮件服务已配置（\(provider)）。保存在数据库中的配置会加密存储。", "Email is configured (\(provider)). Database-stored secrets are encrypted.")
        }

        /// `admin.integrations.emailConfirmDelete`
        public static var integrationsEmailConfirmDelete: String { fmPick("将删除已保存的邮件配置（包括 API Key）。已配置的环境变量不受影响。", "Deletes the saved email configuration (including the API key). Environment configuration is unaffected.") }

        /// `admin.integrations.emailDescription`
        public static var integrationsEmailDescription: String { fmPick("配置注册验证、找回密码等事务邮件的发信渠道。当前支持 Resend（通过其 HTTP API，无需 SMTP）。环境变量（FLAREMO_EMAIL_PROVIDER）配置完整时优先于此处保存的配置。", "Configure the sender for transactional email (verification, password reset). Resend is supported via its HTTP API — no SMTP needed. A fully configured environment (FLAREMO_EMAIL_PROVIDER) takes precedence over this setting.") }

        /// `admin.integrations.emailEnvManaged`
        public static var integrationsEmailEnvManaged: String { fmPick("当前由环境变量管理，此处暂不可编辑。如需改用后台配置，请清空相关环境变量。", "Managed by environment variables; editing here is disabled. Clear the env config to manage it here instead.") }

        /// `admin.integrations.emailError`
        public static var integrationsEmailError: String { fmPick("邮件配置保存失败。", "Saving the email configuration failed.") }

        /// `admin.integrations.emailFrom`
        public static var integrationsEmailFrom: String { fmPick("发件地址（如 no-reply@example.com）", "From address (e.g. no-reply@example.com)") }

        /// `admin.integrations.emailFromName`
        public static var integrationsEmailFromName: String { fmPick("发件人名称（可选）", "Sender name (optional)") }

        /// `admin.integrations.emailTitle`
        public static var integrationsEmailTitle: String { fmPick("邮件服务", "Email service") }

        /// `admin.integrations.emailUnconfigured`
        public static var integrationsEmailUnconfigured: String { fmPick("尚未配置邮件服务：注册验证、找回密码邮件将不可用。", "No email provider configured: verification and password-reset email are unavailable.") }

        /// `admin.integrations.githubConfigure`
        public static var integrationsGithubConfigure: String { fmPick("配置 GitHub 登录凭据", "Configure GitHub sign-in credentials") }

        /// `admin.integrations.googleConfigure`
        public static var integrationsGoogleConfigure: String { fmPick("配置 Google 登录凭据", "Configure Google sign-in credentials") }

        /// `admin.integrations.oauthCallbackPrefix`
        public static var integrationsOauthCallbackPrefix: String { fmPick("回调地址：", "Callback URL:") }

        /// `admin.integrations.oauthClientId`
        public static var integrationsOauthClientId: String { fmPick("Client ID", "Client ID") }

        /// `admin.integrations.oauthClientSecret`
        public static var integrationsOauthClientSecret: String { fmPick("Client Secret", "Client secret") }

        /// `admin.integrations.oauthConfirmDelete`
        public static var integrationsOauthConfirmDelete: String { fmPick("将删除已保存的社交登录配置，登录页不再显示对应按钮。", "Deletes the saved social sign-in configuration; the buttons disappear from the login page.") }

        /// `admin.integrations.oauthDescription`
        public static var integrationsOauthDescription: String { fmPick("配置后登录页会出现对应按钮；用户以已验证的 Google/GitHub 邮箱登录时自动并入同邮箱账号。回调地址需填入对应平台的 OAuth 应用设置。", "Once configured, the login page shows the matching buttons; users signing in with a verified Google/GitHub email are merged into the account with the same address. Register the callback URL in the provider's OAuth app settings.") }

        /// `admin.integrations.oauthEnvManaged`
        public static var integrationsOauthEnvManaged: String { fmPick("当前由环境变量（FLAREMO_OAUTH_*）管理，此处暂不可编辑。", "Managed by environment variables (FLAREMO_OAUTH_*); editing here is disabled.") }

        /// `admin.integrations.oauthError`
        public static var integrationsOauthError: String { fmPick("社交登录配置保存失败。", "Saving the social sign-in configuration failed.") }

        /// `admin.integrations.oauthTitle`
        public static var integrationsOauthTitle: String { fmPick("社交登录", "Social sign-in") }

        /// `admin.integrations.providerActive`
        public static var integrationsProviderActive: String { fmPick("已启用", "Active") }

        /// `admin.integrations.saved`
        public static var integrationsSaved: String { fmPick("集成配置已保存。", "Integration settings saved.") }

        /// `admin.integrations.testEmail`
        public static var integrationsTestEmail: String { fmPick("发送测试邮件", "Send test email") }

        /// `admin.integrations.testSuccess`
        public static var integrationsTestSuccess: String { fmPick("测试邮件已发送，请查收。", "Test email sent — please check your inbox.") }

        /// `admin.makeAdmin`
        public static var makeAdmin: String { fmPick("设为管理员", "Make admin") }

        /// `admin.makeMember`
        public static var makeMember: String { fmPick("设为成员", "Make member") }

        /// `admin.makeReader30`
        public static var makeReader30: String { fmPick("设为读者（30 天）", "Make reader (30 days)") }

        /// `admin.makeReader365`
        public static var makeReader365: String { fmPick("设为读者（365 天）", "Make reader (365 days)") }

        /// `admin.memberActions`
        public static var memberActions: String { fmPick("成员操作", "Member actions") }

        /// `admin.memberSearchEmpty`
        public static var memberSearchEmpty: String { fmPick("没有匹配的成员", "No matching members") }

        /// `admin.memberSearchPlaceholder`
        public static var memberSearchPlaceholder: String { fmPick("搜索姓名、邮箱或用户名", "Search name, email or username") }

        /// `admin.plugins.cardCount`
        public static func pluginsCardCount(count: String) -> String {
            fmPick("\(count) 张卡片", "\(count) cards")
        }

        /// `admin.plugins.cards`
        public static var pluginsCards: String { fmPick("分享卡片", "Share cards") }

        /// `admin.plugins.defaultBadge`
        public static var pluginsDefaultBadge: String { fmPick("默认", "Default") }

        /// `admin.plugins.description`
        public static var pluginsDescription: String { fmPick("管理分享卡片等插件贡献：启用、排序、设默认、调选项。社区插件默认关闭，启用后本实例的用户即可看到。", "Manage plugin contributions such as share cards: enable, reorder, set the default, tune options. Community plugins stay off until enabled here.") }

        /// `admin.plugins.failed`
        public static var pluginsFailed: String { fmPick("插件设置保存失败。", "Failed to save plugin settings.") }

        /// `admin.plugins.hide`
        public static var pluginsHide: String { fmPick("隐藏", "Hide") }

        /// `admin.plugins.install`
        public static var pluginsInstall: String { fmPick("安装", "Install") }

        /// `admin.plugins.installFailed`
        public static var pluginsInstallFailed: String { fmPick("插件安装失败。", "Failed to install the plugin.") }

        /// `admin.plugins.installed`
        public static var pluginsInstalled: String { fmPick("插件已安装。", "Plugin installed.") }

        /// `admin.plugins.installedBadge`
        public static func pluginsInstalledBadge(version: String) -> String {
            fmPick("已安装 v\(version)", "v\(version) installed")
        }

        /// `admin.plugins.kindDocument`
        public static var pluginsKindDocument: String { fmPick("文档", "Document") }

        /// `admin.plugins.kindSandbox`
        public static var pluginsKindSandbox: String { fmPick("沙箱", "Sandbox") }

        /// `admin.plugins.loading`
        public static var pluginsLoading: String { fmPick("加载中…", "Loading…") }

        /// `admin.plugins.moveDown`
        public static var pluginsMoveDown: String { fmPick("下移", "Move down") }

        /// `admin.plugins.moveUp`
        public static var pluginsMoveUp: String { fmPick("上移", "Move up") }

        /// `admin.plugins.pluginOff`
        public static var pluginsPluginOff: String { fmPick("插件已关闭", "Plugin is off") }

        /// `admin.plugins.plugins`
        public static var pluginsPlugins: String { fmPick("已安装插件", "Installed plugins") }

        /// `admin.plugins.refresh`
        public static var pluginsRefresh: String { fmPick("刷新目录", "Refresh directories") }

        /// `admin.plugins.saved`
        public static var pluginsSaved: String { fmPick("插件设置已保存。", "Plugin settings saved.") }

        /// `admin.plugins.setDefault`
        public static var pluginsSetDefault: String { fmPick("设为默认", "Set as default") }

        /// `admin.plugins.show`
        public static var pluginsShow: String { fmPick("显示", "Show") }

        /// `admin.plugins.store`
        public static var pluginsStore: String { fmPick("插件商店", "Plugin store") }

        /// `admin.plugins.storeDescription`
        public static var pluginsStoreDescription: String { fmPick("浏览目录并安装插件包；安装的插件默认关闭，启用后才对用户可见。", "Browse directories and install plugin packages; installed plugins stay off until you enable them.") }

        /// `admin.plugins.storeEmpty`
        public static var pluginsStoreEmpty: String { fmPick("目录里还没有可安装的插件。", "No installable plugins in the directories yet.") }

        /// `admin.plugins.storeUnavailable`
        public static var pluginsStoreUnavailable: String { fmPick("目录暂时不可用，稍后再试。", "Directories are unavailable right now, try again later.") }

        /// `admin.plugins.tierCommunity`
        public static var pluginsTierCommunity: String { fmPick("社区", "Community") }

        /// `admin.plugins.tierOfficial`
        public static var pluginsTierOfficial: String { fmPick("官方", "Official") }

        /// `admin.plugins.tierStore`
        public static var pluginsTierStore: String { fmPick("商店", "Store") }

        /// `admin.plugins.uninstall`
        public static var pluginsUninstall: String { fmPick("卸载", "Uninstall") }

        /// `admin.plugins.uninstallFailed`
        public static var pluginsUninstallFailed: String { fmPick("插件卸载失败。", "Failed to uninstall the plugin.") }

        /// `admin.plugins.uninstalled`
        public static var pluginsUninstalled: String { fmPick("插件已卸载。", "Plugin uninstalled.") }

        /// `admin.plugins.updateTo`
        public static func pluginsUpdateTo(version: String) -> String {
            fmPick("更新到 \(version)", "Update to \(version)")
        }

        /// `admin.plugins.upload`
        public static var pluginsUpload: String { fmPick("上传本地包", "Upload package") }

        /// `admin.plugins.uploadFailed`
        public static var pluginsUploadFailed: String { fmPick("包安装失败。", "Failed to install the package.") }

        /// `admin.plugins.uploaded`
        public static func pluginsUploaded(name: String) -> String {
            fmPick("\(name) 已安装。", "\(name) installed.")
        }

        /// `admin.readerRevokeFailed`
        public static var readerRevokeFailed: String { fmPick("无法撤销读者。", "Could not revoke the reader seat.") }

        /// `admin.readerRevoked`
        public static var readerRevoked: String { fmPick("已撤销读者。", "Reader seat revoked.") }

        /// `admin.readerSet`
        public static var readerSet: String { fmPick("已设置读者有效期。", "Reader expiry set.") }

        /// `admin.readerSetFailed`
        public static var readerSetFailed: String { fmPick("无法设置读者有效期。", "Could not set the reader expiry.") }

        /// `admin.renewReader30`
        public static var renewReader30: String { fmPick("续期读者（30 天）", "Renew reader (30 days)") }

        /// `admin.renewReader365`
        public static var renewReader365: String { fmPick("续期读者（365 天）", "Renew reader (365 days)") }

        /// `admin.resetCopyFailed`
        public static var resetCopyFailed: String { fmPick("无法复制链接，请手动复制。", "Could not copy the link. Copy it by hand.") }

        /// `admin.resetFailed`
        public static var resetFailed: String { fmPick("无法生成重置链接。", "Could not generate a reset link.") }

        /// `admin.resetLinkDescription`
        public static var resetLinkDescription: String { fmPick("链接一次性有效，一小时后过期。用户打开后自行设置密码，你永远不会看到明文。", "The link is single-use and expires in one hour. The user sets their own password; you never see the plaintext.") }

        /// `admin.resetLinkTitle`
        public static var resetLinkTitle: String { fmPick("请把下面的链接安全地发给该用户", "Share this link with the user through a secure channel") }

        /// `admin.resetPassword`
        public static var resetPassword: String { fmPick("重设密码", "Reset password") }

        /// `admin.revokeReader`
        public static var revokeReader: String { fmPick("撤销读者", "Revoke reader") }

        /// `admin.role.admin`
        public static var roleAdmin: String { fmPick("管理员", "Admin") }

        /// `admin.role.member`
        public static var roleMember: String { fmPick("成员", "Member") }

        /// `admin.role.owner`
        public static var roleOwner: String { fmPick("所有者", "Owner") }

        /// `admin.role.reader`
        public static var roleReader: String { fmPick("读者", "Reader") }

        /// `admin.roleUpdateFailed`
        public static var roleUpdateFailed: String { fmPick("无法更新成员角色。", "Could not update the member role.") }

        /// `admin.roleUpdated`
        public static var roleUpdated: String { fmPick("已更新成员角色。", "Member role updated.") }

        /// `admin.selfBadge`
        public static var selfBadge: String { fmPick("你", "You") }

        /// `admin.userCreateFailed`
        public static var userCreateFailed: String { fmPick("无法添加成员。", "Could not add the member.") }

        /// `admin.userCreatedTitle`
        public static var userCreatedTitle: String { fmPick("成员已创建", "Member created") }

        /// `admin.userDeleteFailed`
        public static var userDeleteFailed: String { fmPick("无法移出成员。", "Could not remove the member.") }

        /// `admin.userDeleted`
        public static var userDeleted: String { fmPick("已移出成员。", "Member removed.") }

        /// `admin.usersLoadFailed`
        public static var usersLoadFailed: String { fmPick("无法加载成员列表。", "Could not load the member list.") }

        /// `admin.usersTitle`
        public static var usersTitle: String { fmPick("团队成员", "Team members") }
    }

    /// `article.*`：55 条文案。
    @MainActor
    public enum Article {
        /// `article.autosaveFailed`
        public static var autosaveFailed: String { fmPick("自动保存失败，稍后会重试。", "Autosave failed; it will retry shortly.") }

        /// `article.contentPlaceholder`
        public static var contentPlaceholder: String { fmPick("开始写正文…", "Start writing…") }

        /// `article.createFailed`
        public static var createFailed: String { fmPick("创建文章失败", "Failed to create the article") }

        /// `article.deleteConfirm`
        public static var deleteConfirm: String { fmPick("删除这篇文章？", "Delete this article?") }

        /// `article.deleteDescription`
        public static var deleteDescription: String { fmPick("文章会移到回收站，之后可以在文章列表中恢复。", "It moves to the recycle bin, and you can restore it from the article list.") }

        /// `article.deleteFailed`
        public static var deleteFailed: String { fmPick("删除失败", "Failed to delete") }

        /// `article.deleted`
        public static var deleted: String { fmPick("文章已移入回收站。", "Article moved to the recycle bin.") }

        /// `article.descriptionHint`
        public static var descriptionHint: String { fmPick("显示在搜索结果和社交卡片上，160 字以内效果最好。", "Shown in search results and social cards; under 160 characters works best.") }

        /// `article.descriptionLabel`
        public static var descriptionLabel: String { fmPick("SEO 描述（可选）", "SEO description (optional)") }

        /// `article.descriptionPlaceholder`
        public static var descriptionPlaceholder: String { fmPick("留空则取正文开头", "Leave empty to use the opening text") }

        /// `article.draftBadge`
        public static var draftBadge: String { fmPick("草稿", "Draft") }

        /// `article.editMode`
        public static var editMode: String { fmPick("编辑", "Edit") }

        /// `article.emptyDescription`
        public static var emptyDescription: String { fmPick("把长文从记录里长出来：写一篇可以公开发表的文章。", "Grow a long-form piece out of your notes: write something you can publish.") }

        /// `article.emptyTitle`
        public static var emptyTitle: String { fmPick("还没有文章", "No articles yet") }

        /// `article.filterAll`
        public static var filterAll: String { fmPick("全部", "All") }

        /// `article.filterEmpty`
        public static var filterEmpty: String { fmPick("这里还没有文章", "No articles here yet") }

        /// `article.imageUploadFailed`
        public static var imageUploadFailed: String { fmPick("图片上传失败", "Image upload failed") }

        /// `article.newAction`
        public static var newAction: String { fmPick("写文章", "New article") }

        /// `article.previewAction`
        public static var previewAction: String { fmPick("预览", "Preview") }

        /// `article.publishAction`
        public static var publishAction: String { fmPick("发布", "Publish") }

        /// `article.publishDescription`
        public static var publishDescription: String { fmPick("发布后，任何人都可以通过链接访问这篇文章，搜索引擎可以收录它。", "Once published, anyone with the link can read this article and search engines may index it.") }

        /// `article.publishFailed`
        public static var publishFailed: String { fmPick("发布失败，请重试。", "Publish failed; please retry.") }

        /// `article.publishSuccess`
        public static var publishSuccess: String { fmPick("文章已发布。", "Article published.") }

        /// `article.publishTitle`
        public static var publishTitle: String { fmPick("发布文章", "Publish article") }

        /// `article.publishedBadge`
        public static var publishedBadge: String { fmPick("已发布", "Published") }

        /// `article.restoreAction`
        public static var restoreAction: String { fmPick("恢复", "Restore") }

        /// `article.restoreFailed`
        public static var restoreFailed: String { fmPick("恢复失败，请重试。", "Could not restore the article.") }

        /// `article.restored`
        public static var restored: String { fmPick("文章已恢复。", "Article restored.") }

        /// `article.saved`
        public static var saved: String { fmPick("已保存", "Saved") }

        /// `article.saving`
        public static var saving: String { fmPick("保存中…", "Saving…") }

        /// `article.slugHint`
        public static var slugHint: String { fmPick("发布后链接固定，改标题不影响 URL。", "The URL freezes on publish; renaming the article does not change it.") }

        /// `article.slugLabel`
        public static var slugLabel: String { fmPick("自定义链接（可选）", "Custom slug (optional)") }

        /// `article.slugPlaceholder`
        public static var slugPlaceholder: String { fmPick("留空自动生成", "Leave empty to auto-generate") }

        /// `article.titleLabel`
        public static var titleLabel: String { fmPick("标题", "Title") }

        /// `article.titlePlaceholder`
        public static var titlePlaceholder: String { fmPick("写一个标题…", "Write a title…") }

        /// `article.toolBold`
        public static var toolBold: String { fmPick("加粗", "Bold") }

        /// `article.toolBulletList`
        public static var toolBulletList: String { fmPick("无序列表", "Bullet list") }

        /// `article.toolCode`
        public static var toolCode: String { fmPick("行内代码", "Inline code") }

        /// `article.toolH2`
        public static var toolH2: String { fmPick("二级标题", "Heading 2") }

        /// `article.toolH3`
        public static var toolH3: String { fmPick("三级标题", "Heading 3") }

        /// `article.toolItalic`
        public static var toolItalic: String { fmPick("斜体", "Italic") }

        /// `article.toolOrderedList`
        public static var toolOrderedList: String { fmPick("有序列表", "Ordered list") }

        /// `article.toolQuote`
        public static var toolQuote: String { fmPick("引用", "Blockquote") }

        /// `article.toolRule`
        public static var toolRule: String { fmPick("分隔线", "Horizontal rule") }

        /// `article.toolStrike`
        public static var toolStrike: String { fmPick("删除线", "Strikethrough") }

        /// `article.toolTable`
        public static var toolTable: String { fmPick("表格", "Table") }

        /// `article.toolTaskList`
        public static var toolTaskList: String { fmPick("任务列表", "Task list") }

        /// `article.unpublishAction`
        public static var unpublishAction: String { fmPick("下线", "Unpublish") }

        /// `article.unpublishDescription`
        public static var unpublishDescription: String { fmPick("下线后公开链接立即失效，搜索引擎会在下次抓取时收到 404。", "Unpublishing takes the public link down immediately; search engines get a 404 on the next crawl.") }

        /// `article.unpublishSuccess`
        public static var unpublishSuccess: String { fmPick("文章已下线。", "Article unpublished.") }

        /// `article.unpublishTitle`
        public static var unpublishTitle: String { fmPick("下线文章", "Unpublish article") }

        /// `article.unsaved`
        public static var unsaved: String { fmPick("未保存", "Unsaved") }

        /// `article.untitled`
        public static var untitled: String { fmPick("无标题", "Untitled") }

        /// `article.viewPublic`
        public static var viewPublic: String { fmPick("查看公开页", "View public page") }

        /// `article.wordCount`
        public static func wordCount(count: String) -> String {
            fmPick("\(count) 字", "\(count) characters")
        }
    }

    /// `attachment.*`：1 条文案。
    @MainActor
    public enum Attachment {
        /// `attachment.unavailable`
        public static var unavailable: String { fmPick("文件加载失败，可能已被删除。", "The file failed to load; it may have been deleted.") }
    }

    /// `auth.*`：135 条文案。
    @MainActor
    public enum Auth {
        /// `auth.accountTitle`
        public static var accountTitle: String { fmPick("账户与访问", "Account and access") }

        /// `auth.active`
        public static var active: String { fmPick("有效", "Active") }

        /// `auth.avatar`
        public static var avatar: String { fmPick("个人头像", "Avatar") }

        /// `auth.avatarPresets`
        public static var avatarPresets: String { fmPick("预设可爱头像", "Preset Cute Avatars") }

        /// `auth.avatarUpdateFailed`
        public static var avatarUpdateFailed: String { fmPick("无法更新头像。", "Failed to update avatar.") }

        /// `auth.avatarUrl`
        public static var avatarUrl: String { fmPick("图片链接", "Image URL") }

        /// `auth.bootstrapSecret`
        public static var bootstrapSecret: String { fmPick("初始化密钥", "Setup secret") }

        /// `auth.brandTitle`
        public static var brandTitle: String { fmPick("给已知的一切，一个安静的家。", "A quiet home for everything you know.") }

        /// `auth.captchaFailed`
        public static var captchaFailed: String { fmPick("验证码校验失败，请重试。", "Captcha verification failed. Try again.") }

        /// `auth.captchaRequired`
        public static var captchaRequired: String { fmPick("请先完成验证码。", "Complete the captcha first.") }

        /// `auth.captchaVerifying`
        public static var captchaVerifying: String { fmPick("验证码校验中…", "Verifying captcha…") }

        /// `auth.changeAvatar`
        public static var changeAvatar: String { fmPick("更换头像", "Change avatar") }

        /// `auth.changeEmail`
        public static var changeEmail: String { fmPick("修改邮箱", "Change email") }

        /// `auth.changePassword`
        public static var changePassword: String { fmPick("修改密码", "Change password") }

        /// `auth.completeSetup`
        public static var completeSetup: String { fmPick("完成初始化", "Complete setup") }

        /// `auth.confirmPassword`
        public static var confirmPassword: String { fmPick("确认密码", "Confirm password") }

        /// `auth.confirmingSession`
        public static var confirmingSession: String { fmPick("已登录，正在进入工作区…", "Signed in, opening your workspace…") }

        /// `auth.continueWithGithub`
        public static var continueWithGithub: String { fmPick("使用 GitHub 继续", "Continue with GitHub") }

        /// `auth.continueWithGoogle`
        public static var continueWithGoogle: String { fmPick("使用 Google 继续", "Continue with Google") }

        /// `auth.copied`
        public static var copied: String { fmPick("已复制", "Copied") }

        /// `auth.copyFailed`
        public static var copyFailed: String { fmPick("无法复制令牌，请手动安全保存。", "FlareMo could not copy the token. Save it securely by hand.") }

        /// `auth.copyToken`
        public static var copyToken: String { fmPick("复制令牌", "Copy token") }

        /// `auth.createToken`
        public static var createToken: String { fmPick("创建令牌", "Create token") }

        /// `auth.creatingToken`
        public static var creatingToken: String { fmPick("正在创建…", "Creating…") }

        /// `auth.currentPassword`
        public static var currentPassword: String { fmPick("当前密码", "Current password") }

        /// `auth.deleteAccountDescription`
        public static var deleteAccountDescription: String { fmPick("永久删除你的账户、全部记录、附件、项目与配额数据，并撤销所有登录会话和访问令牌。此操作不可撤销。", "Permanently delete your account with all notes, attachments, projects, and quota data, and revoke every session and access token. This cannot be undone.") }

        /// `auth.deleteAccountFailed`
        public static var deleteAccountFailed: String { fmPick("注销失败，请确认密码后重试。", "Could not delete the account. Check your password and try again.") }

        /// `auth.deleteAccountPassword`
        public static var deleteAccountPassword: String { fmPick("输入当前密码确认注销", "Confirm with your current password") }

        /// `auth.deleteAccountSubmit`
        public static var deleteAccountSubmit: String { fmPick("永久删除我的账户", "Permanently delete my account") }

        /// `auth.deleteAccountTitle`
        public static var deleteAccountTitle: String { fmPick("注销账户", "Delete account") }

        /// `auth.deleteToken`
        public static var deleteToken: String { fmPick("删除", "Delete") }

        /// `auth.deleteTokenConfirm`
        public static func deleteTokenConfirm(name: String) -> String {
            fmPick("删除后该令牌将从列表中永久移除。确定删除「\(name)」吗？", "The token will be permanently removed from the list. Delete “\(name)”?")
        }

        /// `auth.displayName`
        public static var displayName: String { fmPick("显示名称", "Display name") }

        /// `auth.email`
        public static var email: String { fmPick("邮箱", "Email") }

        /// `auth.emailChangeVerificationSent`
        public static var emailChangeVerificationSent: String { fmPick("确认邮件已发送到新邮箱，点击邮件里的链接后新邮箱才会生效。", "A confirmation email was sent to your new address. The change takes effect after you click the link in it.") }

        /// `auth.emailOrUsername`
        public static var emailOrUsername: String { fmPick("邮箱或用户名", "Email or username") }

        /// `auth.emailOrUsernamePlaceholder`
        public static var emailOrUsernamePlaceholder: String { fmPick("you@example.com 或 @username", "you@example.com or @username") }

        /// `auth.emailTitle`
        public static var emailTitle: String { fmPick("修改邮箱", "Change email") }

        /// `auth.emailUpdateFailed`
        public static var emailUpdateFailed: String { fmPick("无法修改邮箱。请确认当前密码后重试。", "Could not change the email. Check the current password and try again.") }

        /// `auth.expires`
        public static var expires: String { fmPick("过期时间", "Expires") }

        /// `auth.forgotPasswordDescription`
        public static var forgotPasswordDescription: String { fmPick("输入注册邮箱，我们会发送一封包含重置链接的邮件。", "Enter your account email and we'll send you a reset link.") }

        /// `auth.forgotPasswordFailed`
        public static var forgotPasswordFailed: String { fmPick("发送失败，请稍后再试。", "Could not send the reset email. Try again later.") }

        /// `auth.forgotPasswordHint`
        public static var forgotPasswordHint: String { fmPick("忘记密码？", "Forgot your password?") }

        /// `auth.forgotPasswordRecoverLink`
        public static var forgotPasswordRecoverLink: String { fmPick("打开恢复页面", "Open recovery page") }

        /// `auth.forgotPasswordSelfHostHint`
        public static var forgotPasswordSelfHostHint: String { fmPick("此部署未配置邮件服务，请使用恢复密钥重置：", "This deployment has no email provider configured. Reset with the recovery key instead:") }

        /// `auth.forgotPasswordSending`
        public static var forgotPasswordSending: String { fmPick("发送中…", "Sending…") }

        /// `auth.forgotPasswordSent`
        public static var forgotPasswordSent: String { fmPick("如果该邮箱已注册，重置邮件已发出（1 小时内有效）。请到邮箱点击链接设置新密码。", "If that address is registered, a reset email is on its way. The link expires in 1 hour — click it to choose a new password.") }

        /// `auth.forgotPasswordSubmit`
        public static var forgotPasswordSubmit: String { fmPick("发送重置链接", "Send reset link") }

        /// `auth.forgotPasswordTitle`
        public static var forgotPasswordTitle: String { fmPick("重置密码", "Reset your password") }

        /// `auth.hidePassword`
        public static var hidePassword: String { fmPick("隐藏密码", "Hide password") }

        /// `auth.hideToken`
        public static var hideToken: String { fmPick("关闭并隐藏", "Hide token") }

        /// `auth.loginFailed`
        public static var loginFailed: String { fmPick("登录失败，请检查用户名和密码后重试。", "Sign-in failed. Check your username and password, then try again.") }

        /// `auth.loginTitle`
        public static var loginTitle: String { fmPick("登录 FlareMo", "Sign in to FlareMo") }

        /// `auth.nameTitle`
        public static var nameTitle: String { fmPick("姓名与昵称", "Display name") }

        /// `auth.nameUpdateFailed`
        public static var nameUpdateFailed: String { fmPick("无法更新姓名。", "Failed to update name.") }

        /// `auth.never`
        public static var never: String { fmPick("永不过期", "Never") }

        /// `auth.newEmail`
        public static var newEmail: String { fmPick("新邮箱", "New email") }

        /// `auth.newPassword`
        public static var newPassword: String { fmPick("新密码", "New password") }

        /// `auth.noEmailProviderNote`
        public static var noEmailProviderNote: String { fmPick("本实例未配置邮件服务：忘记密码与邮件验证功能关闭，密码找回需管理员协助。", "This deployment has no email provider: forgot-password and email verification are disabled, and password recovery needs administrator help.") }

        /// `auth.noTokens`
        public static var noTokens: String { fmPick("还没有个人访问令牌，在上方创建一个。", "No personal access tokens yet — create one above.") }

        /// `auth.oneTimeSetup`
        public static var oneTimeSetup: String { fmPick("一次性初始化", "One-time setup") }

        /// `auth.password`
        public static var password: String { fmPick("密码", "Password") }

        /// `auth.passwordLength`
        public static var passwordLength: String { fmPick("密码至少需要 8 个字符。", "Passwords must be at least 8 characters long.") }

        /// `auth.passwordMismatch`
        public static var passwordMismatch: String { fmPick("两次输入的密码不一致。", "The two passwords do not match.") }

        /// `auth.passwordTitle`
        public static var passwordTitle: String { fmPick("修改密码", "Change password") }

        /// `auth.passwordUpdateFailed`
        public static var passwordUpdateFailed: String { fmPick("无法修改密码。请确认当前密码后重试。", "Could not change the password. Check the current password and try again.") }

        /// `auth.profileTitle`
        public static var profileTitle: String { fmPick("登录名", "Sign-in name") }

        /// `auth.recoveryRequired`
        public static var recoveryRequired: String { fmPick("初始化需要管理员恢复。为避免创建第二个所有者，初始化已锁定。", "Setup requires administrator recovery. Setup is locked to avoid creating a second owner.") }

        /// `auth.registerFailed`
        public static var registerFailed: String { fmPick("注册失败，请检查输入后重试。", "Sign-up failed. Check your input and try again.") }

        /// `auth.registerLink`
        public static var registerLink: String { fmPick("还没有账户？注册", "No account? Sign up") }

        /// `auth.registerTitle`
        public static var registerTitle: String { fmPick("注册 FlareMo 账户", "Create a FlareMo account") }

        /// `auth.registering`
        public static var registering: String { fmPick("正在注册…", "Signing up…") }

        /// `auth.registrationClosed`
        public static var registrationClosed: String { fmPick("当前未开放注册，请联系管理员。", "Registration is currently closed. Contact your administrator.") }

        /// `auth.registrationStatusUnavailable`
        public static var registrationStatusUnavailable: String { fmPick("无法读取注册状态，请检查网络后重试。", "FlareMo could not read the registration status. Check your connection and try again.") }

        /// `auth.registrationUnavailable`
        public static var registrationUnavailable: String { fmPick("注册暂不可用，请稍后重试或联系管理员。", "Registration is unavailable right now. Try again later or contact your administrator.") }

        /// `auth.removeAvatar`
        public static var removeAvatar: String { fmPick("恢复默认头像", "Restore default avatar") }

        /// `auth.resendVerification`
        public static var resendVerification: String { fmPick("重新发送验证邮件", "Resend verification email") }

        /// `auth.resendVerificationSending`
        public static var resendVerificationSending: String { fmPick("发送中…", "Sending…") }

        /// `auth.resendVerificationSent`
        public static var resendVerificationSent: String { fmPick("验证邮件已重新发送，请查收。", "Verification email resent. Check your inbox.") }

        /// `auth.revokeToken`
        public static var revokeToken: String { fmPick("撤销", "Revoke") }

        /// `auth.revokeTokenConfirm`
        public static func revokeTokenConfirm(name: String) -> String {
            fmPick("撤销后使用该令牌的客户端将立即失去访问权限，且无法恢复。确定撤销「\(name)」吗？", "Clients using this token lose access immediately and it cannot be restored. Revoke “\(name)”?")
        }

        /// `auth.revoked`
        public static var revoked: String { fmPick("已撤销", "Revoked") }

        /// `auth.saveName`
        public static var saveName: String { fmPick("保存姓名", "Save name") }

        /// `auth.saveUsername`
        public static var saveUsername: String { fmPick("保存用户名", "Save username") }

        /// `auth.saving`
        public static var saving: String { fmPick("正在保存…", "Saving…") }

        /// `auth.sessionNotStored`
        public static var sessionNotStored: String { fmPick("登录已通过，但浏览器未能保存登录状态；请检查是否禁用了本站 Cookie 后重试。", "Sign-in succeeded, but the browser did not keep the session. Check whether cookies for this site are blocked, then try again.") }

        /// `auth.settingUp`
        public static var settingUp: String { fmPick("正在初始化…", "Setting up…") }

        /// `auth.setupDescription`
        public static var setupDescription: String { fmPick("此页面只在实例尚未初始化时可用，完成后将永久关闭。", "This page is available only while the instance is uninitialized and permanently closes after setup.") }

        /// `auth.setupFailed`
        public static var setupFailed: String { fmPick("初始化失败。请检查输入；若已部分完成，请联系管理员恢复。", "Setup could not finish. Check the input; if it partially completed, ask an administrator to recover it.") }

        /// `auth.setupSecretNotice`
        public static var setupSecretNotice: String { fmPick("初始化密钥仅用于本次初始化，请从安全渠道获取。", "The setup secret is used only for this one-time setup. Obtain it through a secure channel.") }

        /// `auth.setupTitle`
        public static var setupTitle: String { fmPick("创建首个工作区账户", "Create the first workspace account") }

        /// `auth.setupUnavailable`
        public static var setupUnavailable: String { fmPick("初始化暂不可用，请稍后重试或联系管理员。", "Setup is unavailable right now. Try again later or contact your administrator.") }

        /// `auth.showPassword`
        public static var showPassword: String { fmPick("显示密码", "Show password") }

        /// `auth.shufflePresets`
        public static var shufflePresets: String { fmPick("换一批", "Shuffle") }

        /// `auth.signIn`
        public static var signIn: String { fmPick("登录", "Sign in") }

        /// `auth.signOut`
        public static var signOut: String { fmPick("退出登录", "Sign out") }

        /// `auth.signOutFailed`
        public static var signOutFailed: String { fmPick("退出登录失败，请稍后重试", "Sign-out failed. Please try again.") }

        /// `auth.signUp`
        public static var signUp: String { fmPick("注册", "Sign up") }

        /// `auth.signingIn`
        public static var signingIn: String { fmPick("正在登录…", "Signing in…") }

        /// `auth.socialSignInHint`
        public static var socialSignInHint: String { fmPick("或通过以下方式继续", "or continue with") }

        /// `auth.statusUnavailable`
        public static var statusUnavailable: String { fmPick("无法读取当前认证状态，请检查网络后重试。", "FlareMo could not read the current authentication status. Check your connection and try again.") }

        /// `auth.tab.admin`
        public static var tabAdmin: String { fmPick("团队管理", "Team") }

        /// `auth.tab.branding`
        public static var tabBranding: String { fmPick("品牌外观", "Branding") }

        /// `auth.tab.plugins`
        public static var tabPlugins: String { fmPick("插件", "Plugins") }

        /// `auth.tab.usage`
        public static var tabUsage: String { fmPick("用量", "Usage") }

        /// `auth.tokenCreateFailed`
        public static var tokenCreateFailed: String { fmPick("无法创建令牌。", "Could not create the token.") }

        /// `auth.tokenDeleteFailed`
        public static var tokenDeleteFailed: String { fmPick("无法删除令牌。", "Could not delete the token.") }

        /// `auth.tokenExpiry`
        public static var tokenExpiry: String { fmPick("有效期（天）", "Expires in days") }

        /// `auth.tokenExpiryHint`
        public static var tokenExpiryHint: String { fmPick("留空默认 365 天，也可填 1–365 天；只有仅笔记权限的令牌可选择永久有效。", "Leave blank for the 365-day default, or enter 1–365 days. You can opt into a non-expiring token only with notes scope.") }

        /// `auth.tokenName`
        public static var tokenName: String { fmPick("令牌名称", "Token name") }

        /// `auth.tokenPermanent`
        public static var tokenPermanent: String { fmPick("永久有效（仅笔记权限，不自动过期）", "Permanent (notes-only, no automatic expiry)") }

        /// `auth.tokenRevokeFailed`
        public static var tokenRevokeFailed: String { fmPick("无法撤销令牌。", "Could not revoke the token.") }

        /// `auth.tokenScopeAdmin`
        public static var tokenScopeAdmin: String { fmPick("笔记 + 管理", "Notes + admin") }

        /// `auth.tokenScopeAdminHint`
        public static var tokenScopeAdminHint: String { fmPick("同时管理成员、插件与维护端点，仅在实例运维时使用。", "Also manage members, plugins and maintenance. Only use it for instance provisioning.") }

        /// `auth.tokenScopeNotes`
        public static var tokenScopeNotes: String { fmPick("笔记访问", "Notes access") }

        /// `auth.tokenScopeNotesHint`
        public static var tokenScopeNotesHint: String { fmPick("读写笔记、待办、文章、附件与 MCP 工具。", "Read and write notes, tasks, articles, attachments and MCP tools.") }

        /// `auth.tokenScopes`
        public static var tokenScopes: String { fmPick("权限范围", "Scopes") }

        /// `auth.tokenShownOnce`
        public static var tokenShownOnce: String { fmPick("请立即安全保存这个令牌", "Save this token securely now") }

        /// `auth.tokenShownOnceDescription`
        public static var tokenShownOnceDescription: String { fmPick("出于安全原因，关闭此提示后无法再次查看完整令牌。", "For security, the complete token cannot be viewed again after you hide this notice.") }

        /// `auth.tokenValidation`
        public static var tokenValidation: String { fmPick("请填写名称；有效期可留空（默认 365 天）、填 1–365 天，或仅在笔记权限下选择永久有效。", "Enter a name, then leave expiry blank for 365 days, enter a whole number from 1 to 365, or choose permanent for a notes-only token.") }

        /// `auth.tokensLoadFailed`
        public static var tokensLoadFailed: String { fmPick("无法加载个人访问令牌。", "Could not load personal access tokens.") }

        /// `auth.tokensTitle`
        public static var tokensTitle: String { fmPick("个人访问令牌", "Personal access tokens") }

        /// `auth.unnamedToken`
        public static var unnamedToken: String { fmPick("未命名令牌", "Unnamed token") }

        /// `auth.uploadAvatar`
        public static var uploadAvatar: String { fmPick("上传图片", "Upload image") }

        /// `auth.usernameHandle`
        public static var usernameHandle: String { fmPick("用户名", "Username") }

        /// `auth.usernameUpdateFailed`
        public static var usernameUpdateFailed: String { fmPick("无法更新用户名。", "Could not update the username.") }

        /// `auth.verifyEmailChangeInvalid`
        public static var verifyEmailChangeInvalid: String { fmPick("链接无效或已过期，请到账户页重新发起修改。", "This link is invalid or has expired. Start the change again from your account page.") }

        /// `auth.verifyEmailChangeSuccess`
        public static var verifyEmailChangeSuccess: String { fmPick("新邮箱已生效，下次请使用新邮箱登录。", "New email confirmed. Use it to sign in from now on.") }

        /// `auth.verifyEmailChangeTitle`
        public static var verifyEmailChangeTitle: String { fmPick("确认新邮箱", "Confirm new email") }

        /// `auth.verifyEmailHint`
        public static var verifyEmailHint: String { fmPick("点击邮件里的链接完成验证，然后就可以登录了。", "Click the link in the email to finish verifying, then sign in.") }

        /// `auth.verifyEmailInvalid`
        public static var verifyEmailInvalid: String { fmPick("验证链接无效或已过期，请重新注册或联系管理员。", "This verification link is invalid or expired. Please register again or contact the administrator.") }

        /// `auth.verifyEmailSent`
        public static var verifyEmailSent: String { fmPick("验证邮件已发送到", "A verification email was sent to") }

        /// `auth.verifyEmailSuccess`
        public static var verifyEmailSuccess: String { fmPick("邮箱已验证，现在可以登录了。", "Email verified. You can sign in now.") }

        /// `auth.verifyEmailTitle`
        public static var verifyEmailTitle: String { fmPick("验证邮箱", "Verify your email") }

        /// `auth.verifyEmailVerifying`
        public static var verifyEmailVerifying: String { fmPick("正在验证…", "Verifying…") }
    }

    /// `calendar.*`：2 条文案。
    @MainActor
    public enum Calendar {
        /// `calendar.overdueCount`
        public static func overdueCount(count: String) -> String {
            fmPick("本月已逾期 \(count) 件", "\(count) overdue this month")
        }

        /// `calendar.overdueToday`
        public static func overdueToday(count: String) -> String {
            fmPick("今天还有 \(count) 件事没完成", "\(count) item(s) still open today")
        }
    }

    /// `capture.*`：17 条文案。
    @MainActor
    public enum Capture {
        /// `capture.connecting`
        public static var connecting: String { fmPick("麦克风开启 · 正在连接识别服务，请稍候再说话…", "Microphone active · connecting transcription. Please wait to speak…") }

        /// `capture.connectionFailed`
        public static var connectionFailed: String { fmPick("无法连接识别服务，麦克风已关闭。已识别的文字可继续编辑和保存。", "Transcription could not connect. The microphone is off; captured text can still be edited and saved.") }

        /// `capture.finishFailed`
        public static var finishFailed: String { fmPick("未能确认最后一句已完整返回，麦克风已关闭。请检查逐字稿末尾。", "The final sentence could not be confirmed. The microphone is off. Check the end of the transcript.") }

        /// `capture.interrupted`
        public static var interrupted: String { fmPick("录音已中断并关闭麦克风。请检查已识别的文字，末尾可能不完整。", "Recording was interrupted and the microphone is off. Review the captured text; the ending may be incomplete.") }

        /// `capture.limitReached`
        public static var limitReached: String { fmPick("本次记录已达到时长或文字上限，请保存后开始新记录。", "This capture reached its duration or text limit. Save it before starting a new one.") }

        /// `capture.microphoneBusy`
        public static var microphoneBusy: String { fmPick("麦克风无法使用，请关闭占用它的应用后重试。", "The microphone is unavailable. Close other apps using it and retry.") }

        /// `capture.noMicrophone`
        public static var noMicrophone: String { fmPick("未找到麦克风，请检查设备连接后重试。", "No microphone found. Check the device connection and retry.") }

        /// `capture.paused`
        public static var paused: String { fmPick("已暂停 · 计时继续", "Paused · the clock keeps running") }

        /// `capture.permissionDenied`
        public static var permissionDenied: String { fmPick("麦克风权限被拒绝。请在浏览器的网站设置中允许麦克风后重试。", "Microphone access was denied. Allow it in your browser’s site settings, then retry.") }

        /// `capture.recording`
        public static var recording: String { fmPick("可以说话了 · 正在录音", "You can speak · Recording") }

        /// `capture.requestingPermission`
        public static var requestingPermission: String { fmPick("等待麦克风权限…", "Waiting for microphone permission…") }

        /// `capture.stopping`
        public static var stopping: String { fmPick("麦克风已关闭 · 正在接收最后一句…", "Microphone off · receiving the last sentence…") }

        /// `capture.title`
        public static var title: String { fmPick("语音记录", "Voice capture") }

        /// `capture.transcribeFailed`
        public static var transcribeFailed: String { fmPick("转写失败。无法生成识别文本，可手动编辑草稿或放弃本次记录。", "Transcription failed. The recognized text could not be produced; edit the draft manually or discard it.") }

        /// `capture.transcribing`
        public static var transcribing: String { fmPick("转写中…", "Transcribing…") }

        /// `capture.transcribingCount`
        public static func transcribingCount(done: String, total: String) -> String {
            fmPick("正在转写第 \(done) / \(total) 段…", "Transcribing chunk \(done) of \(total)…")
        }

        /// `capture.unavailable`
        public static var unavailable: String { fmPick("语音识别尚未配置或服务暂时不可用，请稍后重试。", "Transcription is not configured or is temporarily unavailable. Try again later.") }
    }

    /// `comments.*`：13 条文案。
    @MainActor
    public enum Comments {
        /// `comments.action`
        public static var action: String { fmPick("评论", "Comment") }

        /// `comments.count`
        public static func count(count: String) -> String {
            fmPick("\(count) 条评论", "\(count) comment(s)")
        }

        /// `comments.createFailed`
        public static var createFailed: String { fmPick("评论发送失败", "Could not send the comment") }

        /// `comments.delete`
        public static var delete: String { fmPick("删除评论", "Delete comment") }

        /// `comments.deleteFailed`
        public static var deleteFailed: String { fmPick("删除评论失败", "Could not delete the comment") }

        /// `comments.deleted`
        public static var deleted: String { fmPick("评论已删除", "Comment deleted") }

        /// `comments.empty`
        public static var empty: String { fmPick("还没有评论", "No comments yet") }

        /// `comments.mentionList`
        public static var mentionList: String { fmPick("可以提到的成员", "People you can mention") }

        /// `comments.placeholder`
        public static var placeholder: String { fmPick("写下评论或批注…", "Write a comment or note…") }

        /// `comments.placeholderMentions`
        public static var placeholderMentions: String { fmPick("写下评论，输入 @ 提到成员…", "Write a comment, type @ to mention someone…") }

        /// `comments.replyTo`
        public static var replyTo: String { fmPick("回到原文", "Back to the note") }

        /// `comments.title`
        public static var title: String { fmPick("评论", "Comments") }

        /// `comments.viewAll`
        public static func viewAll(count: String) -> String {
            fmPick("查看全部 \(count) 条评论", "View all \(count) comments")
        }
    }

    /// `common.*`：20 条文案。
    @MainActor
    public enum Common {
        /// `common.actions`
        public static var actions: String { fmPick("操作", "Actions") }

        /// `common.back`
        public static var back: String { fmPick("返回", "Back") }

        /// `common.cancel`
        public static var cancel: String { fmPick("取消", "Cancel") }

        /// `common.clearFilters`
        public static var clearFilters: String { fmPick("清除筛选", "Clear filters") }

        /// `common.close`
        public static var close: String { fmPick("关闭", "Close") }

        /// `common.copy`
        public static var `copy`: String { fmPick("复制链接", "Copy link") }

        /// `common.delete`
        public static var delete: String { fmPick("删除", "Delete") }

        /// `common.download`
        public static var download: String { fmPick("下载", "Download") }

        /// `common.edit`
        public static var edit: String { fmPick("编辑", "Edit") }

        /// `common.emailInUse`
        public static var emailInUse: String { fmPick("该邮箱已被使用，请换一个。", "That email is already in use. Use a different one.") }

        /// `common.export`
        public static var export: String { fmPick("导出", "Export") }

        /// `common.import`
        public static var `import`: String { fmPick("导入", "Import") }

        /// `common.loading`
        public static var loading: String { fmPick("加载中…", "Loading…") }

        /// `common.more`
        public static var more: String { fmPick("更多", "More") }

        /// `common.restore`
        public static var restore: String { fmPick("恢复", "Restore") }

        /// `common.retry`
        public static var retry: String { fmPick("重试", "Retry") }

        /// `common.save`
        public static var save: String { fmPick("保存", "Save") }

        /// `common.scrollToTop`
        public static var scrollToTop: String { fmPick("回到顶部", "Scroll to top") }

        /// `common.search`
        public static var search: String { fmPick("搜索", "Search") }

        /// `common.undo`
        public static var undo: String { fmPick("撤销", "Undo") }
    }

    /// `composer.*`：47 条文案。
    @MainActor
    public enum Composer {
        /// `composer.addAttachment`
        public static var addAttachment: String { fmPick("添加附件", "Add attachment") }

        /// `composer.addTag`
        public static var addTag: String { fmPick("添加标签", "Add tag") }

        /// `composer.ariaLabel`
        public static var ariaLabel: String { fmPick("新记录", "New note") }

        /// `composer.bulletList`
        public static var bulletList: String { fmPick("列表", "Bullet list") }

        /// `composer.formatMenu`
        public static var formatMenu: String { fmPick("文字格式", "Text formatting") }

        /// `composer.fullscreen.close`
        public static var fullscreenClose: String { fmPick("收起全屏 (Esc)", "Exit full screen (Esc)") }

        /// `composer.fullscreen.readingTime`
        public static func fullscreenReadingTime(minutes: String) -> String {
            fmPick("\(minutes) 分钟阅读", "\(minutes) min read")
        }

        /// `composer.fullscreen.savedLocally`
        public static var fullscreenSavedLocally: String { fmPick("已保存在本地", "Saved locally") }

        /// `composer.fullscreen.wordCount`
        public static func fullscreenWordCount(count: String) -> String {
            fmPick("\(count) 字", "\(count) words")
        }

        /// `composer.heading`
        public static var heading: String { fmPick("标题", "Heading") }

        /// `composer.imageUploadFailed`
        public static var imageUploadFailed: String { fmPick("图片上传失败，请重试", "Image upload failed. Try again.") }

        /// `composer.insertDate`
        public static var insertDate: String { fmPick("插入日期", "Insert date") }

        /// `composer.link`
        public static var link: String { fmPick("链接", "Link") }

        /// `composer.linkApply`
        public static var linkApply: String { fmPick("应用链接", "Apply link") }

        /// `composer.linkEdit`
        public static var linkEdit: String { fmPick("编辑链接", "Edit link") }

        /// `composer.linkOpen`
        public static var linkOpen: String { fmPick("打开链接", "Open link") }

        /// `composer.linkPlaceholder`
        public static var linkPlaceholder: String { fmPick("粘贴或输入链接", "Paste or type a link") }

        /// `composer.linkRemove`
        public static var linkRemove: String { fmPick("移除链接", "Remove link") }

        /// `composer.longform`
        public static var longform: String { fmPick("全屏书写", "Write full screen") }

        /// `composer.mention`
        public static var mention: String { fmPick("提到成员", "Mention someone") }

        /// `composer.offlineNotice`
        public static var offlineNotice: String { fmPick("当前离线，新记录会先存在本机", "You are offline. New notes are kept on this device.") }

        /// `composer.offlinePending`
        public static func offlinePending(count: String) -> String {
            fmPick("\(count) 条记录待同步，联网后自动保存", "\(count) note(s) waiting to sync; they save automatically when connected.")
        }

        /// `composer.orderedList`
        public static var orderedList: String { fmPick("有序列表", "Numbered list") }

        /// `composer.placeholder`
        public static var placeholder: String { fmPick("现在的想法是…", "What's on your mind…") }

        /// `composer.removeFile`
        public static func removeFile(filename: String) -> String {
            fmPick("移除 \(filename)", "Remove \(filename)")
        }

        /// `composer.schedule`
        public static var schedule: String { fmPick("安排为待办", "Schedule as to-do") }

        /// `composer.schedule.clear`
        public static var scheduleClear: String { fmPick("取消安排", "Remove schedule") }

        /// `composer.schedule.hint`
        public static var scheduleHint: String { fmPick("发送后，每条未勾选的待办成为一项任务；没有待办行时，整条便签成为一项任务。到期当天提醒你。", "On send, each open to-do becomes a task; a note without to-dos becomes one task. You get a reminder on the day.") }

        /// `composer.schedule.nextMonday`
        public static var scheduleNextMonday: String { fmPick("下周一", "Next Monday") }

        /// `composer.schedule.noProject`
        public static var scheduleNoProject: String { fmPick("不放进项目", "No project") }

        /// `composer.schedule.noTasks`
        public static var scheduleNoTasks: String { fmPick("没有未完成的待办", "No open to-dos") }

        /// `composer.schedule.pickDate`
        public static var schedulePickDate: String { fmPick("选择日期…", "Pick a date…") }

        /// `composer.schedule.project`
        public static var scheduleProject: String { fmPick("放进项目", "Add to project") }

        /// `composer.schedule.taskCount`
        public static func scheduleTaskCount(count: String) -> String {
            fmPick("\(count) 项待办", "\(count) to-do(s)")
        }

        /// `composer.schedule.today`
        public static var scheduleToday: String { fmPick("今天", "Today") }

        /// `composer.schedule.tomorrow`
        public static var scheduleTomorrow: String { fmPick("明天", "Tomorrow") }

        /// `composer.schedule.when`
        public static var scheduleWhen: String { fmPick("哪天提醒你", "Remind me on") }

        /// `composer.send`
        public static var send: String { fmPick("发送", "Send") }

        /// `composer.taskList`
        public static var taskList: String { fmPick("待办列表", "Task list") }

        /// `composer.type.memo`
        public static var typeMemo: String { fmPick("记录 · 发到时间线", "Note · Post to timeline") }

        /// `composer.visibility.aria`
        public static var visibilityAria: String { fmPick("发送目标", "Send target") }

        /// `composer.visibility.personal`
        public static var visibilityPersonal: String { fmPick("个人", "Personal") }

        /// `composer.visibility.team`
        public static var visibilityTeam: String { fmPick("团队", "Team") }

        /// `composer.voice`
        public static var voice: String { fmPick("语音速记", "Voice note") }

        /// `composer.voiceCancel`
        public static var voiceCancel: String { fmPick("取消", "Cancel") }

        /// `composer.voiceStop`
        public static var voiceStop: String { fmPick("停止并插入", "Stop & insert") }

        /// `composer.wikiLink`
        public static var wikiLink: String { fmPick("引用记录", "Link a note") }
    }

    /// `connect.*`：37 条文案。
    @MainActor
    public enum Connect {
        /// `connect.approvedDescription`
        public static func approvedDescription(name: String) -> String {
            fmPick("「\(name)」现在可以访问你的 FlareMo。", "“\(name)” can now access your FlareMo.")
        }

        /// `connect.approvedTitle`
        public static var approvedTitle: String { fmPick("配对已批准", "Pairing approved") }

        /// `connect.appsEmptyDescription`
        public static var appsEmptyDescription: String { fmPick("在客户端发起配对并批准后，它会连同权限出现在这里。", "Pair from a client and approve it, and it will show up here with its access.") }

        /// `connect.appsEmptyTitle`
        public static var appsEmptyTitle: String { fmPick("还没有连接的应用", "No connected apps yet") }

        /// `connect.appsFooter`
        public static var appsFooter: String { fmPick("配对链接由客户端给出；撤销后该应用立即失去访问权限，需要重新配对才能连接。", "Your client provides the pairing link. Revoking cuts access immediately; reconnecting needs a new pairing.") }

        /// `connect.appsTitle`
        public static var appsTitle: String { fmPick("已连接应用", "Connected apps") }

        /// `connect.clientType.device`
        public static var clientTypeDevice: String { fmPick("设备", "Device") }

        /// `connect.clientType.manual`
        public static var clientTypeManual: String { fmPick("手动令牌", "Manual token") }

        /// `connect.clientType.script`
        public static var clientTypeScript: String { fmPick("脚本", "Script") }

        /// `connect.clientType.web`
        public static var clientTypeWeb: String { fmPick("网页", "Web") }

        /// `connect.codeHint`
        public static var codeHint: String { fmPick("8 位字母或数字，不含 0、O、1、I。", "8 letters or digits, without 0, O, 1 or I.") }

        /// `connect.codeLabel`
        public static var codeLabel: String { fmPick("配对码", "Pairing code") }

        /// `connect.codePlaceholder`
        public static var codePlaceholder: String { fmPick("XXXX-XXXX", "XXXX-XXXX") }

        /// `connect.description`
        public static var description: String { fmPick("客户端会显示一个 8 位配对码。输入后，它就能以你的身份访问 FlareMo。", "Your client shows an 8-character pairing code. Enter it to let the app access FlareMo as you.") }

        /// `connect.errorExpired`
        public static var errorExpired: String { fmPick("这个配对码已过期，请在客户端重新发起配对。", "That pairing code has expired. Start pairing again from your client.") }

        /// `connect.errorFailed`
        public static var errorFailed: String { fmPick("配对没有成功，请稍后重试。", "Pairing didn't go through. Try again in a moment.") }

        /// `connect.errorIncomplete`
        public static var errorIncomplete: String { fmPick("配对码是 8 位，检查一下有没有漏输。", "A pairing code has 8 characters — check for a missing one.") }

        /// `connect.errorNotFound`
        public static var errorNotFound: String { fmPick("没有找到这个配对码，请核对后重新输入。", "We couldn't find that pairing code. Check it and try again.") }

        /// `connect.errorSession`
        public static var errorSession: String { fmPick("登录状态已失效，请重新登录后再试。", "Your session has expired. Sign in again and retry.") }

        /// `connect.errorUsed`
        public static var errorUsed: String { fmPick("这个配对码已经用过了，请在客户端重新发起配对。", "That pairing code was already used. Start pairing again from your client.") }

        /// `connect.grantedScopes`
        public static var grantedScopes: String { fmPick("授权范围", "Granted access") }

        /// `connect.lastUsed`
        public static func lastUsed(date: String) -> String {
            fmPick("最后使用 \(date)", "Last used \(date)")
        }

        /// `connect.manageApps`
        public static var manageApps: String { fmPick("管理已连接应用", "Manage connected apps") }

        /// `connect.neverUsed`
        public static var neverUsed: String { fmPick("尚未使用", "Not used yet") }

        /// `connect.revoke`
        public static var revoke: String { fmPick("撤销", "Revoke") }

        /// `connect.revokeDescription`
        public static var revokeDescription: String { fmPick("撤销后该应用立即失去访问权限，需要重新配对才能连接。", "It loses access immediately and must pair again to reconnect.") }

        /// `connect.revokeFailed`
        public static var revokeFailed: String { fmPick("撤销失败，请重试。", "Couldn't revoke the app. Try again.") }

        /// `connect.revokeTitle`
        public static func revokeTitle(name: String) -> String {
            fmPick("撤销「\(name)」？", "Revoke “\(name)”?")
        }

        /// `connect.revokedToast`
        public static func revokedToast(name: String) -> String {
            fmPick("已撤销「\(name)」", "Revoked “\(name)”")
        }

        /// `connect.scope.admin`
        public static var scopeAdmin: String { fmPick("管理", "Management") }

        /// `connect.scope.adminDetail`
        public static var scopeAdminDetail: String { fmPick("另外可以管理团队、插件和实例维护。", "Also manage members, plugins and instance maintenance.") }

        /// `connect.scope.notes`
        public static var scopeNotes: String { fmPick("记录", "Notes") }

        /// `connect.scope.notesDetail`
        public static var scopeNotesDetail: String { fmPick("读写记录、待办、文章、附件和 MCP 工具。", "Read and write notes, tasks, articles, attachments and MCP tools.") }

        /// `connect.status.expired`
        public static var statusExpired: String { fmPick("已过期", "Expired") }

        /// `connect.submit`
        public static var submit: String { fmPick("批准配对", "Approve pairing") }

        /// `connect.submitting`
        public static var submitting: String { fmPick("正在批准…", "Approving…") }

        /// `connect.title`
        public static var title: String { fmPick("批准配对", "Approve a pairing") }
    }

    /// `detail.*`：27 条文案。
    @MainActor
    public enum Detail {
        /// `detail.backlinks`
        public static var backlinks: String { fmPick("被谁引用", "Referenced by") }

        /// `detail.content`
        public static var content: String { fmPick("内容", "Content") }

        /// `detail.createShare`
        public static var createShare: String { fmPick("创建分享", "Create share") }

        /// `detail.graphCenter`
        public static var graphCenter: String { fmPick("本篇", "This note") }

        /// `detail.history`
        public static var history: String { fmPick("历史", "History") }

        /// `detail.noOutgoing`
        public static var noOutgoing: String { fmPick("还没有引用，在上方搜索记录即可添加。", "No references yet — search above to add one.") }

        /// `detail.noRelationCandidates`
        public static var noRelationCandidates: String { fmPick("没有找到可关联的记录", "No notes found to link") }

        /// `detail.noRelations`
        public static var noRelations: String { fmPick("还没有被其他记录引用。", "No backlinks yet.") }

        /// `detail.noRevisions`
        public static var noRevisions: String { fmPick("还没有历史版本", "No revisions yet") }

        /// `detail.noShares`
        public static var noShares: String { fmPick("还没有有效分享，点上方“创建分享”生成链接。", "No active shares yet — use “Create share” above to make a link.") }

        /// `detail.outgoing`
        public static var outgoing: String { fmPick("引用了谁", "References") }

        /// `detail.related`
        public static var related: String { fmPick("相关记录", "Related notes") }

        /// `detail.relatedMemoPlaceholder`
        public static var relatedMemoPlaceholder: String { fmPick("搜索记录内容或输入记录 ID", "Search note content or enter a note ID") }

        /// `detail.relatedSharedTags`
        public static func relatedSharedTags(tags: String) -> String {
            fmPick("共同标签 \(tags)", "Shared tags \(tags)")
        }

        /// `detail.relatedViaRelation`
        public static var relatedViaRelation: String { fmPick("直接关联", "Linked") }

        /// `detail.relationGraph`
        public static var relationGraph: String { fmPick("关系图", "Graph") }

        /// `detail.relationType.comment`
        public static var relationTypeComment: String { fmPick("评论", "Comment") }

        /// `detail.relationType.reference`
        public static var relationTypeReference: String { fmPick("引用", "Reference") }

        /// `detail.relations`
        public static var relations: String { fmPick("关联", "Links") }

        /// `detail.removeRelation`
        public static func removeRelation(content: String) -> String {
            fmPick("移除与“\(content)”的关联", "Remove link to “\(content)”")
        }

        /// `detail.restoreRevision`
        public static var restoreRevision: String { fmPick("恢复此版本", "Restore") }

        /// `detail.revokeShare`
        public static var revokeShare: String { fmPick("撤销分享", "Revoke share") }

        /// `detail.revokeShareDescription`
        public static var revokeShareDescription: String { fmPick("撤销后链接立即失效，已拿到链接的人将无法再访问。", "The link stops working immediately for anyone who has it.") }

        /// `detail.revokeShareTitle`
        public static var revokeShareTitle: String { fmPick("撤销这个分享链接？", "Revoke this share link?") }

        /// `detail.searchingRelations`
        public static var searchingRelations: String { fmPick("正在搜索记录…", "Searching notes…") }

        /// `detail.sharing`
        public static var sharing: String { fmPick("分享", "Sharing") }

        /// `detail.unavailable`
        public static var unavailable: String { fmPick("记录不可用", "Note unavailable") }
    }

    /// `explorer.*`：37 条文案。
    @MainActor
    public enum Explorer {
        /// `explorer.backToToday`
        public static var backToToday: String { fmPick("回到今日", "Back to today") }

        /// `explorer.classicClock`
        public static var classicClock: String { fmPick("经典天文时计", "Classic astronomical clock") }

        /// `explorer.collapse`
        public static var collapse: String { fmPick("折叠", "Collapse") }

        /// `explorer.dayBreakdown`
        public static func dayBreakdown(count: String, q1: String, q2: String, q3: String, q0: String) -> String {
            fmPick("\(count) 条记录（早 \(q1) · 午 \(q2) · 晚 \(q3) · 夜 \(q0)）", "\(count) notes (morn \(q1), aft \(q2), eve \(q3), night \(q0))")
        }

        /// `explorer.deleteTag`
        public static var deleteTag: String { fmPick("删除标签", "Delete tag") }

        /// `explorer.expand`
        public static var expand: String { fmPick("展开", "Expand") }

        /// `explorer.hourlyScopeFallback`
        public static func hourlyScopeFallback(period: String, count: String) -> String {
            fmPick("所选空间暂不提供小时明细；当前\(period)共 \(count) 条记录。", "Hourly detail is unavailable for the selected space. \(count) notes in this \(period).")
        }

        /// `explorer.loadFailed`
        public static var loadFailed: String { fmPick("侧栏数据加载失败", "Could not load sidebar data") }

        /// `explorer.nextPeriod`
        public static var nextPeriod: String { fmPick("下一期", "Next period") }

        /// `explorer.noRecords`
        public static var noRecords: String { fmPick("无记录", "No notes") }

        /// `explorer.noTags`
        public static var noTags: String { fmPick("还没有标签，用 #标签 开始整理", "No tags yet — start organizing with #tag") }

        /// `explorer.notesCount`
        public static func notesCount(count: String) -> String {
            fmPick("\(count) 条记录", "\(count) notes")
        }

        /// `explorer.periodAfternoon`
        public static var periodAfternoon: String { fmPick("下午 (12-18)", "Afternoon (12-18)") }

        /// `explorer.periodEvening`
        public static var periodEvening: String { fmPick("晚间 (18-24)", "Evening (18-24)") }

        /// `explorer.periodMorning`
        public static var periodMorning: String { fmPick("早晨 (06-12)", "Morning (06-12)") }

        /// `explorer.periodNight`
        public static var periodNight: String { fmPick("夜间 (00-06)", "Night (00-06)") }

        /// `explorer.previousPeriod`
        public static var previousPeriod: String { fmPick("上一期", "Previous period") }

        /// `explorer.records`
        public static var records: String { fmPick("记录", "Notes") }

        /// `explorer.renameTag`
        public static var renameTag: String { fmPick("重命名标签", "Rename tag") }

        /// `explorer.renameTagLabel`
        public static var renameTagLabel: String { fmPick("新名称（支持层级，如 知识/工作）", "New name (hierarchical paths supported, e.g. work/project)") }

        /// `explorer.renameTagPlaceholder`
        public static var renameTagPlaceholder: String { fmPick("输入新标签路径", "Enter the new tag path") }

        /// `explorer.streak`
        public static var streak: String { fmPick("连续天数", "day streak") }

        /// `explorer.tab.day`
        public static var tabDay: String { fmPick("日", "Day") }

        /// `explorer.tab.month`
        public static var tabMonth: String { fmPick("月", "Month") }

        /// `explorer.tab.week`
        public static var tabWeek: String { fmPick("周", "Week") }

        /// `explorer.tab.year`
        public static var tabYear: String { fmPick("年", "Year") }

        /// `explorer.tagDeleteConfirm`
        public static func tagDeleteConfirm(tag: String) -> String {
            fmPick("删除标签 \(tag)？相关记录中的 #标签 会被移除。", "Delete tag \(tag)? The #tag in related notes will be removed.")
        }

        /// `explorer.tagDeleteFailed`
        public static var tagDeleteFailed: String { fmPick("删除标签失败，请重试", "Delete failed, please retry") }

        /// `explorer.tagDeleted`
        public static var tagDeleted: String { fmPick("标签已删除", "Tag deleted") }

        /// `explorer.tagRenameFailed`
        public static var tagRenameFailed: String { fmPick("重命名失败，请重试", "Rename failed, please retry") }

        /// `explorer.tags`
        public static var tags: String { fmPick("标签", "Tags") }

        /// `explorer.timeViewLabel`
        public static var timeViewLabel: String { fmPick("时间视角", "Time view") }

        /// `explorer.today`
        public static var today: String { fmPick("今日", "Today") }

        /// `explorer.untagged`
        public static var untagged: String { fmPick("无标签", "Untagged") }

        /// `explorer.viewDayInTimeline`
        public static var viewDayInTimeline: String { fmPick("在时间线查看该日", "View this day in the timeline") }

        /// `explorer.yearMonthSummary`
        public static func yearMonthSummary(year: String, month: String, count: String, days: String) -> String {
            fmPick("\(year)年\(month) · \(count) 条笔记 (\(days) 活跃天)", "\(year) \(month) · \(count) notes (\(days) active days)")
        }

        /// `explorer.yearTitle`
        public static func yearTitle(year: String) -> String {
            fmPick("\(year)年", "\(year)")
        }
    }

    /// `filter.*`：3 条文案。
    @MainActor
    public enum Filter {
        /// `filter.clearDate`
        public static var clearDate: String { fmPick("清除这一天的筛选", "Clear the day filter") }

        /// `filter.clearTag`
        public static func clearTag(tag: String) -> String {
            fmPick("移除标签筛选：\(tag)", "Remove tag filter: \(tag)")
        }

        /// `filter.clearUntagged`
        public static var clearUntagged: String { fmPick("移除无标签筛选", "Remove untagged filter") }
    }

    /// `imageViewer.*`：5 条文案。
    @MainActor
    public enum ImageViewer {
        /// `imageViewer.next`
        public static var next: String { fmPick("下一张", "Next image") }

        /// `imageViewer.previous`
        public static var previous: String { fmPick("上一张", "Previous image") }

        /// `imageViewer.reset`
        public static var reset: String { fmPick("重置缩放", "Reset zoom") }

        /// `imageViewer.zoomIn`
        public static var zoomIn: String { fmPick("放大", "Zoom in") }

        /// `imageViewer.zoomOut`
        public static var zoomOut: String { fmPick("缩小", "Zoom out") }
    }

    /// `insight.*`：20 条文案。
    @MainActor
    public enum Insight {
        /// `insight.checkAgain`
        public static var checkAgain: String { fmPick("再次检查", "Check again") }

        /// `insight.createFailed`
        public static var createFailed: String { fmPick("洞察任务创建失败，请稍后重试。", "Couldn't create the insight task. Try again later.") }

        /// `insight.creating`
        public static var creating: String { fmPick("正在提交…", "Submitting…") }

        /// `insight.delete`
        public static var delete: String { fmPick("删除", "Delete") }

        /// `insight.deleteDescription`
        public static var deleteDescription: String { fmPick("删除后无法恢复。", "This can't be undone.") }

        /// `insight.deleteFailed`
        public static var deleteFailed: String { fmPick("删除失败，请稍后重试。", "Couldn't delete the insight. Try again.") }

        /// `insight.deleteTitle`
        public static var deleteTitle: String { fmPick("删除这条洞察？", "Delete this insight?") }

        /// `insight.deleted`
        public static var deleted: String { fmPick("已删除这条洞察", "Insight deleted") }

        /// `insight.description`
        public static var description: String { fmPick("让已连接的 AI 客户端读一遍这条记录，给出一份简短洞察。", "Let a connected AI client read this note and return a short insight.") }

        /// `insight.emptyResult`
        public static var emptyResult: String { fmPick("AI 客户端返回了空结果。", "The AI client returned an empty result.") }

        /// `insight.failedFallback`
        public static var failedFallback: String { fmPick("AI 客户端没有给出失败原因。", "The AI client didn't report a reason.") }

        /// `insight.failedTitle`
        public static var failedTitle: String { fmPick("洞察生成失败", "Insight failed") }

        /// `insight.generate`
        public static var generate: String { fmPick("生成洞察", "Generate insight") }

        /// `insight.loadFailed`
        public static var loadFailed: String { fmPick("读取洞察失败，请重试。", "Couldn't load the insight. Try again.") }

        /// `insight.pending`
        public static var pending: String { fmPick("正在等待 AI 客户端处理…", "Waiting for the AI client…") }

        /// `insight.pendingHint`
        public static var pendingHint: String { fmPick("一般一分钟内返回。", "Usually back within a minute.") }

        /// `insight.retry`
        public static var retry: String { fmPick("重试", "Retry") }

        /// `insight.timeoutDescription`
        public static var timeoutDescription: String { fmPick("AI 客户端可能还没有取走这个任务。", "An AI client may not have picked the task up yet.") }

        /// `insight.timeoutTitle`
        public static var timeoutTitle: String { fmPick("暂时没有结果", "No result yet") }

        /// `insight.title`
        public static var title: String { fmPick("AI 洞察", "AI insight") }
    }

    /// `language.*`：1 条文案。
    @MainActor
    public enum Language {
        /// `language.toggle`
        public static var toggle: String { fmPick("切换语言", "Switch language") }
    }

    /// `list.*`：14 条文案。
    @MainActor
    public enum List {
        /// `list.archiveEmptyDescription`
        public static var archiveEmptyDescription: String { fmPick("将暂时用不到的记录归档，时间线更清爽，也能随时找回来。", "Archive notes you do not need right now. You can find them here whenever you need them.") }

        /// `list.archiveEmptyTitle`
        public static var archiveEmptyTitle: String { fmPick("还没有归档记录", "No archived notes yet") }

        /// `list.emptyDescription`
        public static var emptyDescription: String { fmPick("在上方写下第一条记录，让想法有处可寻。", "Write your first note above to give your ideas a home.") }

        /// `list.emptyTitle`
        public static var emptyTitle: String { fmPick("这里还空着", "Nothing here yet") }

        /// `list.errorDescription`
        public static var errorDescription: String { fmPick("网络恢复后再试一次。", "Check your connection and try again.") }

        /// `list.errorTitle`
        public static var errorTitle: String { fmPick("内容加载失败", "Could not load notes") }

        /// `list.filteredEmptyDescription`
        public static var filteredEmptyDescription: String { fmPick("试试其他关键词，或清除筛选查看全部记录。", "Try different keywords, or clear the filters to see all notes.") }

        /// `list.filteredEmptyTitle`
        public static var filteredEmptyTitle: String { fmPick("没有找到相关记录", "No matching notes") }

        /// `list.loadMore`
        public static var loadMore: String { fmPick("加载更多", "Load more") }

        /// `list.loadMoreError`
        public static var loadMoreError: String { fmPick("更多记录加载失败，已加载的内容已保留。", "Could not load more notes. Previously loaded notes are still available.") }

        /// `list.refreshError`
        public static var refreshError: String { fmPick("未能加载最新内容，已加载的记录仍可查看。", "Could not load the latest notes. Previously loaded notes are still available.") }

        /// `list.trashEmptyDescription`
        public static var trashEmptyDescription: String { fmPick("移入回收站的记录会显示在这里，方便恢复或永久删除。", "Notes moved to trash appear here. You can restore or permanently delete them.") }

        /// `list.trashEmptyTitle`
        public static var trashEmptyTitle: String { fmPick("回收站是空的", "The trash is empty") }

        /// `list.updating`
        public static var updating: String { fmPick("正在更新记录…", "Updating notes…") }
    }

    /// `markdown.*`：1 条文案。
    @MainActor
    public enum Markdown {
        /// `markdown.imageUnavailable`
        public static var imageUnavailable: String { fmPick("图片无法加载", "Image unavailable") }
    }

    /// `memo.*`：21 条文案。
    @MainActor
    public enum Memo {
        /// `memo.convertToTask`
        public static var convertToTask: String { fmPick("转为任务", "Convert to task") }

        /// `memo.deleteConfirmDescription`
        public static var deleteConfirmDescription: String { fmPick("删除后无法恢复，相关分享和关系也会一并移除。", "This cannot be undone. Related shares and relations will also be removed.") }

        /// `memo.deleteConfirmTitle`
        public static var deleteConfirmTitle: String { fmPick("彻底删除这条记录？", "Delete this note forever?") }

        /// `memo.deleteForever`
        public static var deleteForever: String { fmPick("彻底删除", "Delete forever") }

        /// `memo.moveToTimeline`
        public static var moveToTimeline: String { fmPick("移回时间线", "Move to timeline") }

        /// `memo.moveToTrash`
        public static var moveToTrash: String { fmPick("移到回收站", "Move to trash") }

        /// `memo.pin`
        public static var pin: String { fmPick("置顶", "Pin") }

        /// `memo.pinned`
        public static var pinned: String { fmPick("已置顶", "Pinned") }

        /// `memo.pinnedBadge`
        public static var pinnedBadge: String { fmPick("已置顶", "Pinned") }

        /// `memo.restore`
        public static var restore: String { fmPick("恢复", "Restore") }

        /// `memo.stateArchived`
        public static var stateArchived: String { fmPick("已归档", "Archived") }

        /// `memo.stateDeleted`
        public static var stateDeleted: String { fmPick("已删除", "Deleted") }

        /// `memo.stateTrashed`
        public static var stateTrashed: String { fmPick("回收站", "Trash") }

        /// `memo.taskMarkDone`
        public static var taskMarkDone: String { fmPick("标记为已完成", "Mark as done") }

        /// `memo.taskMarkTodo`
        public static var taskMarkTodo: String { fmPick("标记为待办", "Mark as todo") }

        /// `memo.tasks.allDone`
        public static var tasksAllDone: String { fmPick("待办已完成", "To-dos done") }

        /// `memo.tasks.open`
        public static var tasksOpen: String { fmPick("在待办中查看", "View in to-dos") }

        /// `memo.tasks.progress`
        public static func tasksProgress(done: String, total: String) -> String {
            fmPick("待办 \(done)/\(total)", "To-dos \(done)/\(total)")
        }

        /// `memo.unpin`
        public static var unpin: String { fmPick("取消置顶", "Unpin") }

        /// `memo.visibilityAndShare`
        public static var visibilityAndShare: String { fmPick("可见性与分享", "Visibility & Sharing") }

        /// `memo.visibilityDialogDescription`
        public static var visibilityDialogDescription: String { fmPick("管理此条记录的访问权限与公开链接。", "Manage access permissions and public share link.") }
    }

    /// `nav.*`：6 条文案。
    @MainActor
    public enum Nav {
        /// `nav.allMemos`
        public static var allMemos: String { fmPick("记录", "Notes") }

        /// `nav.articles`
        public static var articles: String { fmPick("文章", "Articles") }

        /// `nav.dailyReview`
        public static var dailyReview: String { fmPick("今日回顾", "Today's review") }

        /// `nav.projects`
        public static var projects: String { fmPick("待办", "To-dos") }

        /// `nav.randomWalk`
        public static var randomWalk: String { fmPick("随机漫游", "Wander") }

        /// `nav.review`
        public static var review: String { fmPick("回顾", "Review") }
    }

    /// `notFound.*`：3 条文案。
    @MainActor
    public enum NotFound {
        /// `notFound.description`
        public static var description: String { fmPick("这个地址没有对应的页面，可能是链接过期或写错了。", "Nothing lives at this address — the link may be outdated or mistyped.") }

        /// `notFound.home`
        public static var home: String { fmPick("回到首页", "Back to home") }

        /// `notFound.title`
        public static var title: String { fmPick("页面不存在", "Page not found") }
    }

    /// `notifications.*`：8 条文案。
    @MainActor
    public enum Notifications {
        /// `notifications.archiveFailed`
        public static var archiveFailed: String { fmPick("归档通知失败", "Failed to archive the notification.") }

        /// `notifications.empty`
        public static var empty: String { fmPick("还没有通知；往年今天有记录时，会在这里提醒你。", "No notifications yet — notes from this day in past years will land here.") }

        /// `notifications.title`
        public static var title: String { fmPick("通知", "Notifications") }

        /// `notifications.type.dailyReview`
        public static var typeDailyReview: String { fmPick("往年今日", "On this day") }

        /// `notifications.type.memoComment`
        public static var typeMemoComment: String { fmPick("评论了你的记录", "Commented on your note") }

        /// `notifications.type.memoMention`
        public static var typeMemoMention: String { fmPick("在记录中提到了你", "Mentioned you in a note") }

        /// `notifications.type.taskDue`
        public static var typeTaskDue: String { fmPick("今日到期", "Due today") }

        /// `notifications.type.taskOverdue`
        public static var typeTaskOverdue: String { fmPick("任务逾期", "Task overdue") }
    }

    /// `projects.*`：61 条文案。
    @MainActor
    public enum Projects {
        /// `projects.advance.complete`
        public static var advanceComplete: String { fmPick("完成", "Complete") }

        /// `projects.advance.reopen`
        public static var advanceReopen: String { fmPick("重新打开", "Reopen") }

        /// `projects.advance.start`
        public static var advanceStart: String { fmPick("开始", "Start") }

        /// `projects.allProjects`
        public static var allProjects: String { fmPick("全部项目", "All projects") }

        /// `projects.allTasks`
        public static var allTasks: String { fmPick("全部任务", "All tasks") }

        /// `projects.allTasksEmptyDescription`
        public static var allTasksEmptyDescription: String { fmPick("在上方写一条待办，回车保存，它会按状态归入看板。", "Type a to-do above and press Enter; it lands on the board by status.") }

        /// `projects.allTasksEmptyTitle`
        public static var allTasksEmptyTitle: String { fmPick("还没有任务", "No tasks yet") }

        /// `projects.allTasksShort`
        public static var allTasksShort: String { fmPick("全部", "All") }

        /// `projects.archive`
        public static var archive: String { fmPick("归档", "Archive") }

        /// `projects.archivedGroup`
        public static var archivedGroup: String { fmPick("已归档", "Archived") }

        /// `projects.deleteProjectDescription`
        public static var deleteProjectDescription: String { fmPick("项目及其所有任务都会被删除，此操作不可撤销。", "The project and all its tasks will be deleted. This cannot be undone.") }

        /// `projects.deleteProjectTitle`
        public static var deleteProjectTitle: String { fmPick("删除项目？", "Delete project?") }

        /// `projects.deleteTaskDescription`
        public static var deleteTaskDescription: String { fmPick("此任务将被永久删除。", "This task will be permanently deleted.") }

        /// `projects.deleteTaskTitle`
        public static var deleteTaskTitle: String { fmPick("删除任务？", "Delete task?") }

        /// `projects.editProject`
        public static var editProject: String { fmPick("编辑项目", "Edit project") }

        /// `projects.editTask`
        public static var editTask: String { fmPick("编辑任务", "Edit task") }

        /// `projects.field.description`
        public static var fieldDescription: String { fmPick("描述", "Description") }

        /// `projects.field.dueDate`
        public static var fieldDueDate: String { fmPick("截止日期", "Due date") }

        /// `projects.field.name`
        public static var fieldName: String { fmPick("名称", "Name") }

        /// `projects.field.notes`
        public static var fieldNotes: String { fmPick("备注", "Notes") }

        /// `projects.field.priority`
        public static var fieldPriority: String { fmPick("优先级", "Priority") }

        /// `projects.field.project`
        public static var fieldProject: String { fmPick("项目", "Project") }

        /// `projects.field.status`
        public static var fieldStatus: String { fmPick("状态", "Status") }

        /// `projects.field.title`
        public static var fieldTitle: String { fmPick("标题", "Title") }

        /// `projects.fromMemo`
        public static var fromMemo: String { fmPick("来自记录", "From note") }

        /// `projects.group.doneToday`
        public static var groupDoneToday: String { fmPick("今天已完成", "Done today") }

        /// `projects.group.overdue`
        public static var groupOverdue: String { fmPick("已逾期", "Overdue") }

        /// `projects.namePlaceholder`
        public static var namePlaceholder: String { fmPick("例如：网站改版", "e.g. Website redesign") }

        /// `projects.newProject`
        public static var newProject: String { fmPick("新建项目", "New project") }

        /// `projects.newTask`
        public static var newTask: String { fmPick("新建任务", "New task") }

        /// `projects.pickerLabel`
        public static var pickerLabel: String { fmPick("选择项目", "Choose a project") }

        /// `projects.priority.high`
        public static var priorityHigh: String { fmPick("高", "High") }

        /// `projects.priority.low`
        public static var priorityLow: String { fmPick("低", "Low") }

        /// `projects.priority.medium`
        public static var priorityMedium: String { fmPick("中", "Medium") }

        /// `projects.priority.none`
        public static var priorityNone: String { fmPick("无优先级", "No priority") }

        /// `projects.quickAdd.inProject`
        public static func quickAddInProject(name: String) -> String {
            fmPick("放进「\(name)」", "Into “\(name)”")
        }

        /// `projects.quickAdd.inbox`
        public static var quickAddInbox: String { fmPick("不设日期", "No date") }

        /// `projects.quickAdd.label`
        public static var quickAddLabel: String { fmPick("添加待办", "Add a to-do") }

        /// `projects.quickAdd.placeholder`
        public static var quickAddPlaceholder: String { fmPick("添加待办，回车保存", "Add a to-do, press Enter") }

        /// `projects.quickAdd.today`
        public static var quickAddToday: String { fmPick("今天到期", "Due today") }

        /// `projects.quickAdd.tomorrow`
        public static var quickAddTomorrow: String { fmPick("明天到期", "Due tomorrow") }

        /// `projects.setStatus`
        public static var setStatus: String { fmPick("设为状态", "Set status") }

        /// `projects.status.done`
        public static var statusDone: String { fmPick("已完成", "Done") }

        /// `projects.status.in_progress`
        public static var statusIn_progress: String { fmPick("进行中", "In progress") }

        /// `projects.status.todo`
        public static var statusTodo: String { fmPick("待办", "To do") }

        /// `projects.tasksEmptyDescription`
        public static var tasksEmptyDescription: String { fmPick("在这个项目下新建第一个任务。", "Create the first task in this project.") }

        /// `projects.tasksEmptyTitle`
        public static var tasksEmptyTitle: String { fmPick("还没有任务", "No tasks yet") }

        /// `projects.trashEmpty`
        public static var trashEmpty: String { fmPick("回收站是空的", "Trash is empty") }

        /// `projects.unarchive`
        public static var unarchive: String { fmPick("恢复", "Restore") }

        /// `projects.unassigned`
        public static var unassigned: String { fmPick("未分配", "Unassigned") }

        /// `projects.view.allHint`
        public static var viewAllHint: String { fmPick("所有待办，按状态分列", "Every to-do, by status") }

        /// `projects.view.today`
        public static var viewToday: String { fmPick("今天", "Today") }

        /// `projects.view.todayEmptyDescription`
        public static var viewTodayEmptyDescription: String { fmPick("在记录里安排日期，或在上方直接添加。", "Schedule a note, or add a to-do above.") }

        /// `projects.view.todayEmptyTitle`
        public static var viewTodayEmptyTitle: String { fmPick("今天没有要做的事", "Nothing due today") }

        /// `projects.view.todayHint`
        public static var viewTodayHint: String { fmPick("今天到期和已逾期的待办", "Due today or overdue") }

        /// `projects.view.upcoming`
        public static var viewUpcoming: String { fmPick("接下来 7 天", "Next 7 days") }

        /// `projects.view.upcomingEmptyDescription`
        public static var viewUpcomingEmptyDescription: String { fmPick("给便签安排日期后，它们会出现在这里。", "Scheduled notes show up here.") }

        /// `projects.view.upcomingEmptyTitle`
        public static var viewUpcomingEmptyTitle: String { fmPick("接下来一周很清闲", "A quiet week ahead") }

        /// `projects.view.upcomingHint`
        public static var viewUpcomingHint: String { fmPick("未来一周到期的待办", "Due within the coming week") }

        /// `projects.view.upcomingShort`
        public static var viewUpcomingShort: String { fmPick("7 天", "7 days") }

        /// `projects.viewsLabel`
        public static var viewsLabel: String { fmPick("按到期时间查看", "View by due date") }
    }

    /// `push.*`：9 条文案。
    @MainActor
    public enum Push {
        /// `push.description`
        public static var description: String { fmPick("往年今日与逾期日程的浏览器推送提醒。需要通知权限，之后即使页面关闭也会收到提醒。", "Browser push for the on-this-day and overdue-task reminders. Works after the page is closed.") }

        /// `push.notConfigured`
        public static var notConfigured: String { fmPick("本实例未配置推送密钥（需要 FLAREMO_VAPID_PUBLIC_KEY / FLAREMO_VAPID_PRIVATE_KEY）。", "Push keys are not configured (needs FLAREMO_VAPID_PUBLIC_KEY / FLAREMO_VAPID_PRIVATE_KEY).") }

        /// `push.permissionDenied`
        public static var permissionDenied: String { fmPick("浏览器通知权限被拒绝，请在站点设置中允许通知。", "Notification permission was denied; allow notifications in the site settings.") }

        /// `push.subscribeFailed`
        public static var subscribeFailed: String { fmPick("开启推送失败，请重试。", "Enabling push failed. Please retry.") }

        /// `push.subscribed`
        public static var subscribed: String { fmPick("已开启推送提醒", "Push reminders enabled") }

        /// `push.title`
        public static var title: String { fmPick("推送提醒", "Push reminders") }

        /// `push.unconfigured`
        public static var unconfigured: String { fmPick("本实例未配置推送服务。", "This deployment has no push configuration.") }

        /// `push.unsubscribeFailed`
        public static var unsubscribeFailed: String { fmPick("关闭推送失败，请重试。", "Disabling push failed. Please retry.") }

        /// `push.unsubscribed`
        public static var unsubscribed: String { fmPick("已关闭推送提醒", "Push reminders disabled") }
    }

    /// `pwa.*`：14 条文案。
    @MainActor
    public enum Pwa {
        /// `pwa.dismiss`
        public static var dismiss: String { fmPick("不再提示", "Don't show again") }

        /// `pwa.installButton`
        public static var installButton: String { fmPick("安装 FlareMo", "Install FlareMo") }

        /// `pwa.installDescription`
        public static var installDescription: String { fmPick("把 FlareMo 装到桌面或主屏幕，像原生应用一样打开，并支持离线记录与自动同步。", "Install FlareMo to your desktop or home screen to open it like a native app, with offline capture and automatic sync.") }

        /// `pwa.installTitle`
        public static var installTitle: String { fmPick("安装桌面应用", "Install desktop app") }

        /// `pwa.installUnavailable`
        public static var installUnavailable: String { fmPick("当前浏览器不支持一键安装。", "This browser cannot install the app directly.") }

        /// `pwa.installedDescription`
        public static var installedDescription: String { fmPick("当前已在独立窗口中运行。离线记录会在恢复联网后自动同步。", "Running in its own window. Offline notes sync automatically once you are back online.") }

        /// `pwa.installedTitle`
        public static var installedTitle: String { fmPick("已安装为应用", "Installed as an app") }

        /// `pwa.iosHint`
        public static var iosHint: String { fmPick("在 Safari 中点击「分享」，再选择「添加到主屏幕」，即可安装。", "In Safari, tap Share and choose “Add to Home Screen” to install.") }

        /// `pwa.offlineDescription`
        public static var offlineDescription: String { fmPick("断网时仍可继续写记录与草稿，重新联网后按顺序自动提交。", "Keep writing notes and drafts without a connection; they submit in order once access returns.") }

        /// `pwa.offlineTitle`
        public static var offlineTitle: String { fmPick("离线可用", "Works offline") }

        /// `pwa.updateAvailable`
        public static var updateAvailable: String { fmPick("有新版本可用", "A new version is available") }

        /// `pwa.updateDescription`
        public static var updateDescription: String { fmPick("刷新后即可使用最新版本。", "Reload to use the latest version.") }

        /// `pwa.updateLater`
        public static var updateLater: String { fmPick("稍后", "Later") }

        /// `pwa.updateNow`
        public static var updateNow: String { fmPick("立即更新", "Update now") }
    }

    /// `reading.*`：11 条文案。
    @MainActor
    public enum Reading {
        /// `reading.audioUnavailable`
        public static var audioUnavailable: String { fmPick("音频文件加载失败，文件可能已被删除。", "The audio file failed to load; it may have been deleted.") }

        /// `reading.collapse`
        public static var collapse: String { fmPick("收起", "Show less") }

        /// `reading.downloadAudio`
        public static var downloadAudio: String { fmPick("下载音频文件", "Download audio file") }

        /// `reading.expand`
        public static var expand: String { fmPick("展开全文", "Show full text") }

        /// `reading.follow`
        public static var follow: String { fmPick("跟随播放滚动", "Scroll to follow playback") }

        /// `reading.followShort`
        public static var followShort: String { fmPick("跟随", "Follow") }

        /// `reading.outline`
        public static var outline: String { fmPick("目录", "Outline") }

        /// `reading.pause`
        public static var pause: String { fmPick("暂停", "Pause") }

        /// `reading.play`
        public static var play: String { fmPick("播放", "Play") }

        /// `reading.rate`
        public static func rate(rate: String) -> String {
            fmPick("播放速度 \(rate) 倍", "Playback speed \(rate)x")
        }

        /// `reading.seek`
        public static var seek: String { fmPick("播放进度", "Playback position") }
    }

    /// `recover.*`：7 条文案。
    @MainActor
    public enum Recover {
        /// `recover.description`
        public static var description: String { fmPick("使用部署时配置的恢复密钥重设 owner 密码。完成后该密钥应立即轮换或删除。", "Reset the owner password with the recovery secret from your deployment. Rotate or remove that secret immediately afterward.") }

        /// `recover.failed`
        public static var failed: String { fmPick("恢复失败，请确认恢复密钥后重试。", "Recovery failed. Check the recovery secret and try again.") }

        /// `recover.secret`
        public static var secret: String { fmPick("恢复密钥", "Recovery secret") }

        /// `recover.submit`
        public static var submit: String { fmPick("恢复密码", "Recover password") }

        /// `recover.submitting`
        public static var submitting: String { fmPick("正在恢复…", "Recovering…") }

        /// `recover.success`
        public static var success: String { fmPick("owner 密码已恢复。现在可以登录。", "Owner password recovered. You can now sign in.") }

        /// `recover.title`
        public static var title: String { fmPick("管理员恢复", "Administrator recovery") }
    }

    /// `reset.*`：7 条文案。
    @MainActor
    public enum Reset {
        /// `reset.description`
        public static var description: String { fmPick("设置一个新密码。完成后用新密码登录。", "Choose a new password, then sign in with it.") }

        /// `reset.failed`
        public static var failed: String { fmPick("重置失败，令牌可能已过期或被使用。", "Reset failed. The token may have expired or been used.") }

        /// `reset.missingToken`
        public static var missingToken: String { fmPick("缺少重置令牌，请使用管理员提供的完整链接。", "The reset token is missing. Use the full link your administrator provided.") }

        /// `reset.submit`
        public static var submit: String { fmPick("重设密码", "Reset password") }

        /// `reset.submitting`
        public static var submitting: String { fmPick("正在重设…", "Resetting…") }

        /// `reset.success`
        public static var success: String { fmPick("密码已更新。现在可以用新密码登录。", "Password updated. You can now sign in with it.") }

        /// `reset.title`
        public static var title: String { fmPick("重设密码", "Reset password") }
    }

    /// `review.*`：59 条文案。
    @MainActor
    public enum Review {
        /// `review.archive`
        public static var archive: String { fmPick("归档", "Archive") }

        /// `review.archived`
        public static var archived: String { fmPick("已归档", "Archived") }

        /// `review.dailyEmptyDescription`
        public static var dailyEmptyDescription: String { fmPick("从今天开始记录，明年此时就能与今天重逢。", "Start writing today, and this page will greet you next year.") }

        /// `review.dailyEmptyTitle`
        public static var dailyEmptyTitle: String { fmPick("往年的今天还没有记录", "No notes from this day yet") }

        /// `review.daysAgo`
        public static func daysAgo(count: String) -> String {
            fmPick("\(count) 天前", "\(count) days ago")
        }

        /// `review.deckProgress`
        public static func deckProgress(current: String, total: String) -> String {
            fmPick("\(current) / \(total)", "\(current) / \(total)")
        }

        /// `review.doneDescription`
        public static func doneDescription(count: String) -> String {
            fmPick("重读了 \(count) 条旧记录。读过的记录一个月内不会再出现。", "You reread \(count) old notes. Notes you've read stay away for a month.")
        }

        /// `review.doneTitle`
        public static var doneTitle: String { fmPick("今天的回顾读完了", "Today's review is done") }

        /// `review.doneWeek`
        public static func doneWeek(count: String) -> String {
            fmPick("这一周你写下了 \(count) 条新记录。", "This week you wrote \(count) new notes.")
        }

        /// `review.doneWeekEmpty`
        public static var doneWeekEmpty: String { fmPick("这一周还没有新记录，今天写一条吧。", "No new notes this week yet. Why not write one today?") }

        /// `review.excludedTagsEmpty`
        public static var excludedTagsEmpty: String { fmPick("还没有标签。", "No tags yet.") }

        /// `review.excludedTagsHint`
        public static var excludedTagsHint: String { fmPick("选中的标签和它的子标签都会跳过。", "A selected tag also skips its child tags.") }

        /// `review.excludedTagsTitle`
        public static var excludedTagsTitle: String { fmPick("不回顾这些标签", "Skip these tags") }

        /// `review.finish`
        public static var finish: String { fmPick("读完了", "Done") }

        /// `review.goWalk`
        public static var goWalk: String { fmPick("去随机漫游", "Take a random walk") }

        /// `review.monthsAgo`
        public static func monthsAgo(count: String) -> String {
            fmPick("\(count) 个月前", "\(count) months ago")
        }

        /// `review.mute`
        public static var mute: String { fmPick("不再回顾", "Don't show again") }

        /// `review.muted`
        public static var muted: String { fmPick("这条不会再出现在回顾里", "This note won't come up in the review again") }

        /// `review.mutedCount`
        public static func mutedCount(count: String) -> String {
            fmPick("\(count) 条", "\(count) notes")
        }

        /// `review.mutedNone`
        public static var mutedNone: String { fmPick("暂无", "None") }

        /// `review.mutedRestore`
        public static var mutedRestore: String { fmPick("全部恢复", "Restore all") }

        /// `review.mutedTitle`
        public static var mutedTitle: String { fmPick("设为不再回顾的记录", "Notes set to not show again") }

        /// `review.next`
        public static var next: String { fmPick("下一条", "Next") }

        /// `review.onThisDayBanner`
        public static func onThisDayBanner(count: String) -> String {
            fmPick("今日回顾 · 还有 \(count) 条旧记录", "Today's review · \(count) old notes left")
        }

        /// `review.oneYearAgoToday`
        public static var oneYearAgoToday: String { fmPick("1 年前的今天", "1 year ago today") }

        /// `review.postcardStats`
        public static func postcardStats(count: String, characters: String) -> String {
            fmPick("本次经过 \(count) 条记录 · 共 \(characters) 字", "\(count) notes · \(characters) characters")
        }

        /// `review.postcardTitle`
        public static var postcardTitle: String { fmPick("漫游明信片", "Wander postcard") }

        /// `review.previous`
        public static var previous: String { fmPick("上一条", "Previous") }

        /// `review.readAgain`
        public static var readAgain: String { fmPick("从头再看", "Start over") }

        /// `review.reply`
        public static var reply: String { fmPick("补一句", "Add a thought") }

        /// `review.season.autumn`
        public static var seasonAutumn: String { fmPick("秋", "autumn") }

        /// `review.season.spring`
        public static var seasonSpring: String { fmPick("春", "spring") }

        /// `review.season.summer`
        public static var seasonSummer: String { fmPick("夏", "summer") }

        /// `review.season.winter`
        public static var seasonWinter: String { fmPick("冬", "winter") }

        /// `review.settingsDescription`
        public static var settingsDescription: String { fmPick("决定哪些记录不进入每日回顾。", "Choose which notes stay out of the daily review.") }

        /// `review.settingsTitle`
        public static var settingsTitle: String { fmPick("回顾设置", "Review settings") }

        /// `review.spanPoint`
        public static func spanPoint(year: String, season: String) -> String {
            fmPick("\(year) 年\(season)", "\(season) \(year)")
        }

        /// `review.timeSpan`
        public static func timeSpan(start: String, end: String) -> String {
            fmPick("从 \(start) 到 \(end)", "From \(start) to \(end)")
        }

        /// `review.todayIntro`
        public static func todayIntro(count: String) -> String {
            fmPick("还有 \(count) 条旧记录等你重读。", "\(count) old notes left to reread today.")
        }

        /// `review.todayIntroDone`
        public static func todayIntroDone(count: String) -> String {
            fmPick("今天的 \(count) 条旧记录都读过了。", "All \(count) of today's old notes are read.")
        }

        /// `review.todayIntroEmpty`
        public static var todayIntroEmpty: String { fmPick("今天没有要重读的旧记录。", "No old notes to reread today.") }

        /// `review.viaJump`
        public static var viaJump: String { fmPick("一次大跨越", "A big leap") }

        /// `review.viaRelation`
        public static var viaRelation: String { fmPick("沿引用走来", "Following a link") }

        /// `review.viaTag`
        public static func viaTag(tag: String) -> String {
            fmPick("途经 #\(tag)", "Via #\(tag)")
        }

        /// `review.walkAgain`
        public static var walkAgain: String { fmPick("再来一场", "Wander again") }

        /// `review.walkBack`
        public static var walkBack: String { fmPick("上一站", "Back") }

        /// `review.walkContinue`
        public static var walkContinue: String { fmPick("继续漫游", "Keep wandering") }

        /// `review.walkEmptyDescription`
        public static var walkEmptyDescription: String { fmPick("先写下几条记录，再来这里漫游。", "Write a few notes first, then come back for a walk.") }

        /// `review.walkEmptyTitle`
        public static var walkEmptyTitle: String { fmPick("还没有可以漫游的记录", "No notes to wander through yet") }

        /// `review.walkExhausted`
        public static var walkExhausted: String { fmPick("没有更多可以漫游到的记录了", "No more notes to wander to") }

        /// `review.walkExhaustedHint`
        public static var walkExhaustedHint: String { fmPick("所有相连的记录都走过了，就此结束，或者再来一场。", "Every connected note has been visited. End the walk, or start another.") }

        /// `review.walkFinish`
        public static var walkFinish: String { fmPick("结束漫游", "End the wander") }

        /// `review.walkHistory`
        public static func walkHistory(count: String) -> String {
            fmPick("已走过 \(count) 条", "\(count) stops so far")
        }

        /// `review.walkIntro`
        public static var walkIntro: String { fmPick("从一条旧记录出发，沿着标签和引用走到下一条。", "Start from an old note and follow its tags and links to the next one.") }

        /// `review.walkKeyHint`
        public static var walkKeyHint: String { fmPick("← → 键也能走", "← → keys work too") }

        /// `review.weeksAgo`
        public static func weeksAgo(count: String) -> String {
            fmPick("\(count) 周前", "\(count) weeks ago")
        }

        /// `review.writeFirstMemo`
        public static var writeFirstMemo: String { fmPick("写下第一条记录", "Write your first note") }

        /// `review.writeTodayMemo`
        public static var writeTodayMemo: String { fmPick("写下今日记录", "Write today's note") }

        /// `review.yearsAgoToday`
        public static func yearsAgoToday(count: String) -> String {
            fmPick("\(count) 年前的今天", "\(count) years ago today")
        }
    }

    /// `scope.*`：1 条文案。
    @MainActor
    public enum Scope {
        /// `scope.label`
        public static var label: String { fmPick("记录范围", "Note scope") }
    }

    /// `search.*`：21 条文案。
    @MainActor
    public enum Search {
        /// `search.actionNewMemo`
        public static var actionNewMemo: String { fmPick("新建记录", "New note") }

        /// `search.actionToggleTheme`
        public static var actionToggleTheme: String { fmPick("切换外观模式", "Toggle appearance mode") }

        /// `search.clear`
        public static var clear: String { fmPick("清除搜索", "Clear search") }

        /// `search.emptyHint`
        public static var emptyHint: String { fmPick("未找到匹配项", "No matches found") }

        /// `search.globalScope`
        public static var globalScope: String { fmPick("正在搜索时间线和归档", "Searching timeline and archive") }

        /// `search.navigateHint`
        public static var navigateHint: String { fmPick("移动", "Navigate") }

        /// `search.noResultsHint`
        public static var noResultsHint: String { fmPick("关键词没找到？试试语义搜索，按意思来找。", "No keyword matches? Try semantic search — find by meaning instead.") }

        /// `search.pressEnterHint`
        public static var pressEnterHint: String { fmPick("按回车查看", "Press Enter to view") }

        /// `search.remoteUnavailable`
        public static var remoteUnavailable: String { fmPick("全局搜索暂不可用，当前仅显示本地匹配结果", "Global search is unavailable. Showing local matches only.") }

        /// `search.selectHint`
        public static var selectHint: String { fmPick("选择", "Select") }

        /// `search.semanticDegraded`
        public static var semanticDegraded: String { fmPick("语义搜索服务暂时不可用，这些结果来自关键词搜索。", "Semantic search is temporarily unavailable; these results come from keyword search.") }

        /// `search.semanticEmpty`
        public static var semanticEmpty: String { fmPick("没有找到语义相近的记录，试试换个说法或先确认已建立语义索引。", "No semantically similar notes found. Try rephrasing, or verify the semantic index is built.") }

        /// `search.semanticPlaceholder`
        public static var semanticPlaceholder: String { fmPick("找一找：用自然语言描述…", "Find: describe in natural language…") }

        /// `search.semanticToggle`
        public static var semanticToggle: String { fmPick("语义搜索", "Semantic search") }

        /// `search.semanticToggleShort`
        public static var semanticToggleShort: String { fmPick("语义", "Semantic") }

        /// `search.shortcutHintC`
        public static var shortcutHintC: String { fmPick("快捷键 C", "Shortcut: C") }

        /// `search.spotlightPlaceholder`
        public static var spotlightPlaceholder: String { fmPick("搜索记录、任务、操作…", "Search notes, tasks, actions…") }

        /// `search.syntaxHint`
        public static var syntaxHint: String { fmPick("筛选：has:attachment · is:pinned · before:2026-07-01 · after:2026-07-01 · in:archive", "Filters: has:attachment · is:pinned · before:2026-07-01 · after:2026-07-01 · in:archive") }

        /// `search.taskResults`
        public static var taskResults: String { fmPick("任务", "Tasks") }

        /// `search.triggerPlaceholder`
        public static var triggerPlaceholder: String { fmPick("搜索记录…", "Search notes…") }

        /// `search.viewInTimeline`
        public static func viewInTimeline(query: String) -> String {
            fmPick("在时间线中搜索“\(query)”", "Search \"\(query)\" in timeline")
        }
    }

    /// `settings.*`：15 条文案。
    @MainActor
    public enum Settings {
        /// `settings.done`
        public static var done: String { fmPick("完成", "Done") }

        /// `settings.group.account`
        public static var groupAccount: String { fmPick("账户与安全", "Account & Security") }

        /// `settings.group.admin`
        public static var groupAdmin: String { fmPick("系统管理", "Administration") }

        /// `settings.group.preferences`
        public static var groupPreferences: String { fmPick("偏好与服务", "Preferences & Services") }

        /// `settings.nav.appearance`
        public static var navAppearance: String { fmPick("外观", "Appearance") }

        /// `settings.nav.connectedApps`
        public static var navConnectedApps: String { fmPick("已连接应用", "Connected apps") }

        /// `settings.nav.integrations`
        public static var navIntegrations: String { fmPick("集成服务", "Integrations") }

        /// `settings.nav.push`
        public static var navPush: String { fmPick("推送通知", "Push notifications") }

        /// `settings.nav.transfer`
        public static var navTransfer: String { fmPick("导入导出", "Import & export") }

        /// `settings.nav.uploads`
        public static var navUploads: String { fmPick("上传", "Uploads") }

        /// `settings.nav.voice`
        public static var navVoice: String { fmPick("语音服务", "Voice service") }

        /// `settings.status.configured`
        public static var statusConfigured: String { fmPick("已配置", "Configured") }

        /// `settings.status.envManaged`
        public static var statusEnvManaged: String { fmPick("环境变量配置", "Environment managed") }

        /// `settings.status.notConfigured`
        public static var statusNotConfigured: String { fmPick("未配置", "Not configured") }

        /// `settings.title`
        public static var title: String { fmPick("设置", "Settings") }
    }

    /// `share.*`：21 条文案。
    @MainActor
    public enum Share {
        /// `share.copyFailed`
        public static var copyFailed: String { fmPick("复制链接失败，请重试", "Copy failed, please try again") }

        /// `share.copyLink`
        public static var copyLink: String { fmPick("复制链接", "Copy link") }

        /// `share.exportFailed`
        public static var exportFailed: String { fmPick("图片导出失败，请重试", "Image export failed, please try again") }

        /// `share.exportImage`
        public static var exportImage: String { fmPick("导出图片", "Export image") }

        /// `share.exporting`
        public static var exporting: String { fmPick("导出中…", "Exporting…") }

        /// `share.generatingLink`
        public static var generatingLink: String { fmPick("正在生成链接…", "Generating link…") }

        /// `share.imageCard`
        public static var imageCard: String { fmPick("生成卡片", "Create card") }

        /// `share.imageStats`
        public static func imageStats(count: String, days: String) -> String {
            fmPick("\(count) 条记录 · \(days) 天", "\(count) notes · \(days) days")
        }

        /// `share.imageSubtitle`
        public static var imageSubtitle: String { fmPick("选一个模板，导出成图片", "Pick a template and export it as an image") }

        /// `share.imageTitle`
        public static var imageTitle: String { fmPick("生成图片卡片", "Create image card") }

        /// `share.loadingTemplate`
        public static var loadingTemplate: String { fmPick("正在加载模板…", "Loading template…") }

        /// `share.openLink`
        public static var openLink: String { fmPick("打开链接", "Open link") }

        /// `share.publicLink`
        public static var publicLink: String { fmPick("公开链接", "Public link") }

        /// `share.sandboxFrameTitle`
        public static var sandboxFrameTitle: String { fmPick("分享卡片预览", "Share card preview") }

        /// `share.template.daily`
        public static var templateDaily: String { fmPick("日签", "Daily") }

        /// `share.template.plain`
        public static var templatePlain: String { fmPick("素白", "Plain") }

        /// `share.template.ticket`
        public static var templateTicket: String { fmPick("票根", "Ticket") }

        /// `share.templateLabel`
        public static var templateLabel: String { fmPick("模板", "Template") }

        /// `share.templateUnavailable`
        public static var templateUnavailable: String { fmPick("这个模板加载失败，换一张试试。", "This template failed to load — try another one.") }

        /// `share.unavailable`
        public static var unavailable: String { fmPick("分享不可用。", "This share is unavailable.") }

        /// `share.unavailableDescription`
        public static var unavailableDescription: String { fmPick("链接可能已过期、被撤销或对应记录不可公开访问。", "The link may have expired, been revoked, or point to a note that is no longer public.") }
    }

    /// `shortcuts.*`：11 条文案。
    @MainActor
    public enum Shortcuts {
        /// `shortcuts.cancel`
        public static var cancel: String { fmPick("取消或关闭", "Cancel or close") }

        /// `shortcuts.composer`
        public static var composer: String { fmPick("聚焦新记录输入框", "Focus the new note composer") }

        /// `shortcuts.help`
        public static var help: String { fmPick("快捷键帮助", "Keyboard shortcuts") }

        /// `shortcuts.linebreak`
        public static var linebreak: String { fmPick("在输入框内换行", "Insert a line break while composing") }

        /// `shortcuts.saveEdit`
        public static var saveEdit: String { fmPick("保存编辑中的记录", "Save the note being edited") }

        /// `shortcuts.search`
        public static var search: String { fmPick("聚焦搜索", "Focus search") }

        /// `shortcuts.send`
        public static var send: String { fmPick("发送当前输入", "Send the current draft") }

        /// `shortcuts.sidebar`
        public static var sidebar: String { fmPick("收起或展开侧栏", "Collapse or expand the sidebar") }

        /// `shortcuts.subtitle`
        public static var subtitle: String { fmPick("随时可用的全局快捷键。", "Global shortcuts, available anywhere.") }

        /// `shortcuts.theme`
        public static var theme: String { fmPick("切换明暗模式", "Toggle dark mode") }

        /// `shortcuts.title`
        public static var title: String { fmPick("快捷键", "Keyboard shortcuts") }
    }

    /// `sidebar.*`：7 条文案。
    @MainActor
    public enum Sidebar {
        /// `sidebar.collapse`
        public static var collapse: String { fmPick("收起侧栏", "Collapse sidebar") }

        /// `sidebar.expand`
        public static var expand: String { fmPick("展开侧栏", "Expand sidebar") }

        /// `sidebar.navigation`
        public static var navigation: String { fmPick("导航", "Navigation") }

        /// `sidebar.resize`
        public static var resize: String { fmPick("拖动调整宽度，双击隐藏", "Drag to resize, double-click to hide") }

        /// `sidebar.storage`
        public static var storage: String { fmPick("归档与回收站", "Archive and trash") }

        /// `sidebar.title`
        public static var title: String { fmPick("侧边栏", "Sidebar") }

        /// `sidebar.toggle`
        public static var toggle: String { fmPick("切换侧边栏", "Toggle sidebar") }
    }

    /// `space.*`：5 条文案。
    @MainActor
    public enum Space {
        /// `space.all`
        public static var all: String { fmPick("全部空间", "All spaces") }

        /// `space.expiredNotice`
        public static var expiredNotice: String { fmPick("你的读者有效期已过，团队空间暂时无法访问，续期后自动恢复。", "Your reader access has expired. The team space is unavailable until it is renewed.") }

        /// `space.personal`
        public static var personal: String { fmPick("个人空间", "Personal Space") }

        /// `space.readonlyNotice`
        public static var readonlyNotice: String { fmPick("此空间为只读——你是读者，可以浏览但不能发布。", "This space is read-only — you are a reader and can browse but not publish.") }

        /// `space.team`
        public static var team: String { fmPick("团队空间", "Team Space") }
    }

    /// `theme.*`：9 条文案。
    @MainActor
    public enum Theme {
        /// `theme.dark`
        public static var dark: String { fmPick("深色模式", "Dark") }

        /// `theme.darkDescription`
        public static var darkDescription: String { fmPick("适合暗光环境，更低刺激更护眼", "Easy on the eyes in low light") }

        /// `theme.light`
        public static var light: String { fmPick("浅色模式", "Light") }

        /// `theme.lightDescription`
        public static var lightDescription: String { fmPick("保持素雅明亮的界面风格", "Clean and bright classic interface") }

        /// `theme.previewDetails`
        public static var previewDetails: String { fmPick("快捷键", "Shortcuts") }

        /// `theme.shortcutTip`
        public static var shortcutTip: String { fmPick("在任何非输入区域按 D 键可快速切换明暗模式", "Press D in non-input areas to quickly toggle theme") }

        /// `theme.system`
        public static var system: String { fmPick("跟随系统", "System") }

        /// `theme.systemDescription`
        public static var systemDescription: String { fmPick("自动匹配操作系统的明暗设置", "Automatically match your system appearance") }

        /// `theme.title`
        public static var title: String { fmPick("外观模式", "Appearance") }
    }

    /// `toast.*`：53 条文案。
    @MainActor
    public enum Toast {
        /// `toast.accessRequired`
        public static var accessRequired: String { fmPick("登录状态已失效，请重新登录", "Your sign-in has expired. Please sign in again.") }

        /// `toast.attachmentTooLarge`
        public static var attachmentTooLarge: String { fmPick("单个附件不能超过 25 MiB", "Each attachment must be 25 MiB or smaller") }

        /// `toast.copied`
        public static var copied: String { fmPick("链接已复制", "Link copied") }

        /// `toast.copyFailed`
        public static var copyFailed: String { fmPick("复制失败，请手动复制链接。", "Copy failed; copy the link manually.") }

        /// `toast.deleted`
        public static var deleted: String { fmPick("已删除", "Deleted") }

        /// `toast.draftRestored`
        public static var draftRestored: String { fmPick("已恢复未完成的草稿", "Restored your unfinished draft") }

        /// `toast.exportFailed`
        public static func exportFailed(message: String) -> String {
            fmPick("导出失败：\(message)", "Export failed: \(message)")
        }

        /// `toast.exportInlineDone`
        public static var exportInlineDone: String { fmPick("导出完成，完整数据包已下载", "Export complete, full data bundle downloaded") }

        /// `toast.exportManifestDone`
        public static var exportManifestDone: String { fmPick("导出完成，清单已下载", "Export complete, manifest downloaded") }

        /// `toast.exportStarted`
        public static var exportStarted: String { fmPick("导出任务已开始，正在生成数据包…", "Export task started, building the data bundle…") }

        /// `toast.importDone`
        public static func importDone(count: String) -> String {
            fmPick("已导入 \(count) 条", "Imported \(count) notes")
        }

        /// `toast.importFailed`
        public static func importFailed(message: String) -> String {
            fmPick("导入失败：\(message)", "Import failed: \(message)")
        }

        /// `toast.importStarted`
        public static var importStarted: String { fmPick("导入任务已开始，正在处理…", "Import task started, processing…") }

        /// `toast.invalidImport`
        public static var invalidImport: String { fmPick("导入文件不是有效的 JSON", "The import file is not valid JSON") }

        /// `toast.linkCopied`
        public static var linkCopied: String { fmPick("链接已复制", "Link copied") }

        /// `toast.memoTooLong`
        public static var memoTooLong: String { fmPick("记录内容不能超过 100,000 个字符", "A note cannot exceed 100,000 characters") }

        /// `toast.movedToTrash`
        public static var movedToTrash: String { fmPick("已移到回收站", "Moved to trash") }

        /// `toast.offlineStorageUnavailable`
        public static var offlineStorageUnavailable: String { fmPick("无法在此设备上保存离线记录", "This device cannot store the note for offline sync.") }

        /// `toast.projectArchiveFailed`
        public static var projectArchiveFailed: String { fmPick("归档项目失败", "Failed to archive project") }

        /// `toast.projectArchived`
        public static var projectArchived: String { fmPick("项目已归档", "Project archived") }

        /// `toast.projectCreateFailed`
        public static var projectCreateFailed: String { fmPick("创建项目失败", "Failed to create project") }

        /// `toast.projectCreated`
        public static var projectCreated: String { fmPick("项目已创建", "Project created") }

        /// `toast.projectDeleteFailed`
        public static var projectDeleteFailed: String { fmPick("删除项目失败", "Failed to delete project") }

        /// `toast.projectDeleted`
        public static var projectDeleted: String { fmPick("项目已删除", "Project deleted") }

        /// `toast.projectUnarchived`
        public static var projectUnarchived: String { fmPick("项目已恢复", "Project restored") }

        /// `toast.projectUpdateFailed`
        public static var projectUpdateFailed: String { fmPick("更新项目失败", "Failed to update project") }

        /// `toast.projectUpdated`
        public static var projectUpdated: String { fmPick("项目已更新", "Project updated") }

        /// `toast.queueNeedsAttention`
        public static func queueNeedsAttention(count: String) -> String {
            fmPick("有 \(count) 条离线记录尚无法提交；恢复网络或访问权限后会继续重试", "\(count) offline note(s) still need attention and will retry when access or connectivity returns.")
        }

        /// `toast.queueSynced`
        public static var queueSynced: String { fmPick("离线记录已保存", "Offline note saved") }

        /// `toast.queuedForSync`
        public static var queuedForSync: String { fmPick("当前离线，记录会在联网后自动保存", "You are offline. This note will save automatically when connected.") }

        /// `toast.relationAdded`
        public static var relationAdded: String { fmPick("已添加关联", "Link added") }

        /// `toast.relationRemoved`
        public static var relationRemoved: String { fmPick("已移除关联", "Link removed") }

        /// `toast.requestFailed`
        public static var requestFailed: String { fmPick("操作失败，请重试", "Action failed. Please try again.") }

        /// `toast.restored`
        public static var restored: String { fmPick("已恢复", "Restored") }

        /// `toast.revisionRestored`
        public static var revisionRestored: String { fmPick("已恢复历史版本", "Revision restored") }

        /// `toast.saved`
        public static var saved: String { fmPick("已保存", "Saved") }

        /// `toast.scheduleFailed`
        public static var scheduleFailed: String { fmPick("记录已保存，但待办没有建成；可在卡片上逐条转为任务", "Note saved, but its to-dos were not scheduled. Convert them from the card instead.") }

        /// `toast.scheduledTasks`
        public static func scheduledTasks(count: String) -> String {
            fmPick("已记下，加入 \(count) 项待办", "Saved, with \(count) to-do(s) scheduled")
        }

        /// `toast.shareCreated`
        public static var shareCreated: String { fmPick("已创建分享", "Share created") }

        /// `toast.shareRevoked`
        public static var shareRevoked: String { fmPick("已撤销分享", "Share revoked") }

        /// `toast.taskCreateFailed`
        public static var taskCreateFailed: String { fmPick("创建任务失败", "Failed to create task") }

        /// `toast.taskCreated`
        public static var taskCreated: String { fmPick("任务已创建", "Task created") }

        /// `toast.taskDeleteFailed`
        public static var taskDeleteFailed: String { fmPick("删除任务失败", "Failed to delete task") }

        /// `toast.taskDeleted`
        public static var taskDeleted: String { fmPick("任务已删除", "Task deleted") }

        /// `toast.taskPending`
        public static var taskPending: String { fmPick("任务处理中…", "Task in progress…") }

        /// `toast.taskTimeout`
        public static var taskTimeout: String { fmPick("任务处理时间过长，请稍后在导出记录中查看状态", "The task is taking too long. Check its status and try again later.") }

        /// `toast.taskUpdateFailed`
        public static var taskUpdateFailed: String { fmPick("更新任务失败", "Failed to update task") }

        /// `toast.taskUpdated`
        public static var taskUpdated: String { fmPick("任务已更新", "Task updated") }

        /// `toast.tooManyAttachments`
        public static var tooManyAttachments: String { fmPick("一条记录最多添加 100 个附件", "A note can have at most 100 attachments") }

        /// `toast.tooManyMemoImages`
        public static var tooManyMemoImages: String { fmPick("一条记录最多 9 张图片，更多图片可以写成文章", "A note holds up to 9 images. Write an article for more.") }

        /// `toast.untitledAttachment`
        public static var untitledAttachment: String { fmPick("未命名附件", "Untitled attachment") }

        /// `toast.untrustedOrigin`
        public static func untrustedOrigin(origin: String) -> String {
            fmPick("当前访问地址 \(origin) 不是本站的可信地址，保存被拒绝。请用部署域名打开，或把该地址加入 FLAREMO_TRUSTED_ORIGINS", "\(origin) is not a trusted address for this FlareMo, so the change was rejected. Open FlareMo at its deployed URL, or add this address to FLAREMO_TRUSTED_ORIGINS.")
        }

        /// `toast.updated`
        public static var updated: String { fmPick("已更新", "Updated") }
    }

    /// `today.*`：1 条文案。
    @MainActor
    public enum Today {
        /// `today.overdueSince`
        public static func overdueSince(date: String) -> String {
            fmPick("\(date) 到期", "Due \(date)")
        }
    }

    /// `transfer.*`：13 条文案。
    @MainActor
    public enum Transfer {
        /// `transfer.download`
        public static var download: String { fmPick("下载清单", "Download manifest") }

        /// `transfer.empty`
        public static var empty: String { fmPick("还没有数据传输任务。", "No data transfer tasks yet.") }

        /// `transfer.export`
        public static var export: String { fmPick("导出", "Export") }

        /// `transfer.import`
        public static var `import`: String { fmPick("导入", "Import") }

        /// `transfer.loadFailed`
        public static var loadFailed: String { fmPick("无法加载数据传输任务。", "Could not load data transfer tasks.") }

        /// `transfer.newExport`
        public static var newExport: String { fmPick("新建导出", "New export") }

        /// `transfer.retry`
        public static var retry: String { fmPick("重新生成", "Regenerate") }

        /// `transfer.retryFailed`
        public static var retryFailed: String { fmPick("重新生成导出失败", "Failed to regenerate the export.") }

        /// `transfer.status.expired`
        public static var statusExpired: String { fmPick("已过期", "Expired") }

        /// `transfer.status.failed`
        public static var statusFailed: String { fmPick("失败", "Failed") }

        /// `transfer.status.queued`
        public static var statusQueued: String { fmPick("排队中", "Queued") }

        /// `transfer.status.running`
        public static var statusRunning: String { fmPick("进行中", "Running") }

        /// `transfer.status.succeeded`
        public static var statusSucceeded: String { fmPick("已完成", "Done") }
    }

    /// `update.*`：13 条文案。
    @MainActor
    public enum Update {
        /// `update.availableTitle`
        public static func availableTitle(version: String) -> String {
            fmPick("有新版本 \(version)", "New version \(version) available")
        }

        /// `update.badge`
        public static var badge: String { fmPick("有更新", "Update") }

        /// `update.checkFailed`
        public static var checkFailed: String { fmPick("暂时无法检查最新版本。", "Latest version check unavailable right now.") }

        /// `update.checkUpdates`
        public static var checkUpdates: String { fmPick("检查更新", "Check for updates") }

        /// `update.guide`
        public static var guide: String { fmPick("升级指南", "Update guide") }

        /// `update.loading`
        public static var loading: String { fmPick("正在检查版本…", "Checking…") }

        /// `update.rangeLine`
        public static func rangeLine(current: String, latest: String, published: String) -> String {
            fmPick("v\(current) → v\(latest) · 发布于 \(published)", "v\(current) → v\(latest) · published \(published)")
        }

        /// `update.rangeLineNoDate`
        public static func rangeLineNoDate(current: String, latest: String) -> String {
            fmPick("当前 v\(current) → 最新 v\(latest)", "Current v\(current) → latest v\(latest)")
        }

        /// `update.releaseNotes`
        public static var releaseNotes: String { fmPick("版本说明", "Release notes") }

        /// `update.repositoryNotConfigured`
        public static var repositoryNotConfigured: String { fmPick("此实例未配置一键升级仓库，按部署指南手动升级即可。", "One-click update repository is not configured for this instance; follow the deploy guide to upgrade manually.") }

        /// `update.title`
        public static var title: String { fmPick("系统已是最新", "Up to date") }

        /// `update.versionLine`
        public static func versionLine(current: String, published: String) -> String {
            fmPick("v\(current) · 发布于 \(published)", "v\(current) · published \(published)")
        }

        /// `update.versionLineNoDate`
        public static func versionLineNoDate(current: String) -> String {
            fmPick("当前 v\(current)", "Current v\(current)")
        }
    }

    /// `uploads.*`：4 条文案。
    @MainActor
    public enum Uploads {
        /// `uploads.audioCompression`
        public static var audioCompression: String { fmPick("音频压缩", "Compress audio") }

        /// `uploads.audioCompressionDescription`
        public static var audioCompressionDescription: String { fmPick("WAV、FLAC 等无损音频上传前转为 Opus（有损压缩）；关闭后保留原格式。", "Transcode lossless audio (WAV, FLAC…) to lossy Opus before upload. Turn off to keep the original format.") }

        /// `uploads.imageCompression`
        public static var imageCompression: String { fmPick("图片压缩", "Compress images") }

        /// `uploads.imageCompressionDescription`
        public static var imageCompressionDescription: String { fmPick("上传前把图片转为 WebP；关闭后保留原图上传。", "Convert images to WebP before upload. Turn off to upload the original file as-is.") }
    }

    /// `usage.*`：25 条文案。
    @MainActor
    public enum Usage {
        /// `usage.cfD1Rows`
        public static var cfD1Rows: String { fmPick("本月读 / 写行数", "Rows read / written this month") }

        /// `usage.cfD1Storage`
        public static var cfD1Storage: String { fmPick("D1 存储", "D1 storage") }

        /// `usage.cfDisclaimer`
        public static var cfDisclaimer: String { fmPick("数据来自 Cloudflare Analytics 官方口径；R2 存储约有 24 小时延迟，最终计费以 Cloudflare Dashboard 为准。", "Figures come from Cloudflare Analytics directly; R2 storage lags by about 24 hours. Final billing is governed by the Cloudflare Dashboard.") }

        /// `usage.cfPartial`
        public static var cfPartial: String { fmPick("部分数据不可用", "Some data unavailable") }

        /// `usage.cfPeriod`
        public static var cfPeriod: String { fmPick("统计周期", "Period") }

        /// `usage.cfR2Objects`
        public static var cfR2Objects: String { fmPick("R2 对象数", "R2 objects") }

        /// `usage.cfR2Ops`
        public static var cfR2Ops: String { fmPick("本月 Class A / B 操作", "Class A / B ops this month") }

        /// `usage.cfR2Storage`
        public static var cfR2Storage: String { fmPick("R2 存储", "R2 storage") }

        /// `usage.cfTitle`
        public static var cfTitle: String { fmPick("Cloudflare 资源用量", "Cloudflare resource usage") }

        /// `usage.cfWorkerRequests`
        public static var cfWorkerRequests: String { fmPick("本月请求数", "Requests this month") }

        /// `usage.disclaimer`
        public static var disclaimer: String { fmPick("以上为自测估算，非 Cloudflare 官方账单；最终计费以 Cloudflare Dashboard 为准。", "Self-measured estimate, not Cloudflare's official bill; final billing is per the Cloudflare Dashboard.") }

        /// `usage.model`
        public static var model: String { fmPick("模型", "Model") }

        /// `usage.planEmbeddingTokens`
        public static var planEmbeddingTokens: String { fmPick("本月 Embedding Tokens", "Embedding tokens this month") }

        /// `usage.planMembers`
        public static var planMembers: String { fmPick("成员数", "Members") }

        /// `usage.planMemos`
        public static var planMemos: String { fmPick("记录条数", "Notes") }

        /// `usage.planSearchQueries`
        public static var planSearchQueries: String { fmPick("本月语义搜索", "Semantic searches this month") }

        /// `usage.planStorage`
        public static var planStorage: String { fmPick("附件存储", "Attachment storage") }

        /// `usage.planTitle`
        public static var planTitle: String { fmPick("部署限额", "Deployment quota") }

        /// `usage.planUserTitle`
        public static var planUserTitle: String { fmPick("个人限额", "Your quota") }

        /// `usage.queried`
        public static var queried: String { fmPick("本月查询维度", "Queried dimensions this month") }

        /// `usage.stored`
        public static var stored: String { fmPick("存储维度", "Stored dimensions") }

        /// `usage.storedHint`
        public static var storedHint: String { fmPick("= 向量数 × 维度", "= vectors × dimensions") }

        /// `usage.vectorTitle`
        public static var vectorTitle: String { fmPick("向量用量", "Vector usage") }

        /// `usage.vectorUnavailable`
        public static var vectorUnavailable: String { fmPick("暂时无法获取向量用量。", "Vector usage is unavailable right now.") }

        /// `usage.vectors`
        public static var vectors: String { fmPick("向量数", "Vectors") }
    }

    /// `view.*`：2 条文案。
    @MainActor
    public enum View {
        /// `view.archive`
        public static var archive: String { fmPick("归档", "Archive") }

        /// `view.trash`
        public static var trash: String { fmPick("回收站", "Trash") }
    }

    /// `visibility.*`：6 条文案。
    @MainActor
    public enum Visibility {
        /// `visibility.private`
        public static var `private`: String { fmPick("仅自己可见", "Only me") }

        /// `visibility.privateDescription`
        public static var privateDescription: String { fmPick("仅自己登录后可查看与编辑", "Only you can view and edit after signing in") }

        /// `visibility.protected`
        public static var protected: String { fmPick("团队可见", "Team") }

        /// `visibility.protectedDescription`
        public static var protectedDescription: String { fmPick("同空间成员可阅读此记录", "Visible to members of this workspace") }

        /// `visibility.public`
        public static var `public`: String { fmPick("全网公开", "Public web") }

        /// `visibility.publicDescription`
        public static var publicDescription: String { fmPick("任何获得链接的人均可查看", "Anyone with the link can view") }
    }

    /// `voiceSettings.*`：41 条文案。
    @MainActor
    public enum VoiceSettings {
        /// `voiceSettings.apiKey`
        public static var apiKey: String { fmPick("DashScope API Key", "DashScope API Key") }

        /// `voiceSettings.appId`
        public static var appId: String { fmPick("腾讯云 AppID", "Tencent Cloud AppID") }

        /// `voiceSettings.clearConfig`
        public static var clearConfig: String { fmPick("清除语音配置", "Clear voice configuration") }

        /// `voiceSettings.clearConfirm`
        public static var clearConfirm: String { fmPick("确定要清除当前的语音服务凭据配置吗？清除后语音转文字功能将被停用。", "Are you sure you want to clear voice service credentials? Speech-to-text will be disabled.") }

        /// `voiceSettings.configure`
        public static var configure: String { fmPick("配置服务凭据", "Configure credentials") }

        /// `voiceSettings.configured`
        public static var configured: String { fmPick("凭据已配置", "Credentials configured") }

        /// `voiceSettings.confirmDelete`
        public static var confirmDelete: String { fmPick("删除凭据并停用语音服务？删除后环境变量不会自动接管，需重新配置。", "Delete credentials and disable voice capture? Environment variables will not take over automatically afterwards; reconfigure to enable again.") }

        /// `voiceSettings.credentials`
        public static var credentials: String { fmPick("凭据", "Credentials") }

        /// `voiceSettings.delete`
        public static var delete: String { fmPick("删除凭据并停用", "Delete credentials and disable") }

        /// `voiceSettings.deleted`
        public static var deleted: String { fmPick("凭据已删除，语音服务已停用。", "Credentials deleted. Voice capture disabled.") }

        /// `voiceSettings.description`
        public static var description: String { fmPick("全站共享服务，仅实例所有者可配置。保存的密钥不会回显，留空保留已存凭据。", "Shared site service, configured only by the instance owner. Saved secrets are never displayed. Leave fields blank to keep credentials saved here.") }

        /// `voiceSettings.enabled`
        public static var enabled: String { fmPick("启用语音记录", "Enable voice capture") }

        /// `voiceSettings.envManaged`
        public static var envManaged: String { fmPick("当前由环境变量（FLAREMO_ASR_*）提供凭据，此处保存的配置将在移除环境变量后生效。", "Credentials currently come from environment variables (FLAREMO_ASR_*). Settings saved here take effect after those variables are removed.") }

        /// `voiceSettings.error`
        public static var error: String { fmPick("操作失败，请刷新配置后重试；检查凭据、余额和服务区域。", "Operation failed. Reload settings and check credentials, balance, and region.") }

        /// `voiceSettings.loadError`
        public static var loadError: String { fmPick("无法加载语音配置，请刷新重试。", "Could not load voice settings. Refresh to retry.") }

        /// `voiceSettings.migration`
        public static var migration: String { fmPick("首次改用站点设置或切换服务商时，请填写全部凭据；部署环境的密钥不会自动导入。", "Enter all credentials when first switching to site settings or changing provider. Environment secrets are not imported automatically.") }

        /// `voiceSettings.minimax`
        public static var minimax: String { fmPick("MiniMax", "MiniMax") }

        /// `voiceSettings.minimaxApiKey`
        public static var minimaxApiKey: String { fmPick("MiniMax API Key", "MiniMax API Key") }

        /// `voiceSettings.minimaxBaseUrl`
        public static var minimaxBaseUrl: String { fmPick("MiniMax Base URL（可选，默认国内节点）", "MiniMax base URL (optional; domestic by default)") }

        /// `voiceSettings.model`
        public static var model: String { fmPick("识别模型（留空使用默认）", "Recognition model (blank uses the default)") }

        /// `voiceSettings.modelDefault`
        public static var modelDefault: String { fmPick("默认", "Default") }

        /// `voiceSettings.modelLabel`
        public static var modelLabel: String { fmPick("识别模型", "Recognition model") }

        /// `voiceSettings.plainStore`
        public static var plainStore: String { fmPick("未设置加密密钥（FLAREMO_VOICE_CONFIG_KEY），凭据将以明文存入数据库（D1 自带静态加密）；配置密钥后再次保存即可升级为加密存储。", "No encryption key (FLAREMO_VOICE_CONFIG_KEY) is set, so credentials are stored as plaintext in the database (D1 is encrypted at rest). Set the key and save again to upgrade to encrypted storage.") }

        /// `voiceSettings.provider`
        public static var provider: String { fmPick("服务商", "Provider") }

        /// `voiceSettings.save`
        public static var save: String { fmPick("保存配置", "Save settings") }

        /// `voiceSettings.saved`
        public static var saved: String { fmPick("配置已保存。", "Settings saved.") }

        /// `voiceSettings.secretId`
        public static var secretId: String { fmPick("腾讯云 SecretId", "Tencent Cloud SecretId") }

        /// `voiceSettings.secretKey`
        public static var secretKey: String { fmPick("腾讯云 SecretKey", "Tencent Cloud SecretKey") }

        /// `voiceSettings.tencent`
        public static var tencent: String { fmPick("腾讯云", "Tencent Cloud") }

        /// `voiceSettings.test`
        public static var test: String { fmPick("测试已保存的连接", "Test saved connection") }

        /// `voiceSettings.testAction`
        public static var testAction: String { fmPick("测试", "Test") }

        /// `voiceSettings.testSuccess`
        public static var testSuccess: String { fmPick("连接测试成功。", "Connection test succeeded.") }

        /// `voiceSettings.testWarning`
        public static var testWarning: String { fmPick("连接测试使用当前生效的配置，可能产生少量云服务费用，不验证实际转写质量。", "Connection tests use the effective settings and may incur cloud charges. They do not verify transcription quality.") }

        /// `voiceSettings.title`
        public static var title: String { fmPick("语音识别设置", "Voice recognition settings") }

        /// `voiceSettings.unconfigured`
        public static var unconfigured: String { fmPick("尚未配置", "Not configured") }

        /// `voiceSettings.unreadable`
        public static var unreadable: String { fmPick("无法解密原凭据。请恢复加密密钥，或删除凭据后重新配置。", "Cannot decrypt saved credentials. Restore the encryption key, or delete and replace the credentials.") }

        /// `voiceSettings.volcAccessToken`
        public static var volcAccessToken: String { fmPick("火山引擎 Access Token", "Volcano Engine Access Token") }

        /// `voiceSettings.volcAppId`
        public static var volcAppId: String { fmPick("火山引擎 AppID", "Volcano Engine AppID") }

        /// `voiceSettings.volcBoostingTable`
        public static var volcBoostingTable: String { fmPick("热词表名（可选）", "Boosting table name (optional)") }

        /// `voiceSettings.volcCorrectTable`
        public static var volcCorrectTable: String { fmPick("替换词表名（可选）", "Correct table name (optional)") }

        /// `voiceSettings.volcengine`
        public static var volcengine: String { fmPick("豆包 / 火山引擎", "Doubao / Volcano Engine") }
    }
}

/// 生成物内部的语言选择器：参数顺序固定为 zh-Hans、en-US（即 LOCALES 里 emitted 的顺序）。
/// 要加第三种语言时，把它换成 switch 或参数表，不要在末尾直接追加参数。
@MainActor
private func fmPick(_ zhHans: String, _ enUS: String) -> String {
    switch L10n.language {
    case .zhHans: zhHans
    case .enUS: enUS
    }
}
