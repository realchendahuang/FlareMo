import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "flaremo.locale";

const messages = {
  "zh-CN": {
    "app.name": "FlareMo",
    "common.search": "搜索",
    "search.placeholder": "搜索记录…",
    "search.results": "搜索结果",
    "search.globalScope": "正在搜索时间线和归档",
    "search.syntaxHint":
      "筛选：has:attachment · is:pinned · before:2026-07-01 · after:2026-07-01 · in:archive",
    "common.clearFilters": "清除筛选",
    "common.save": "保存",
    "common.cancel": "取消",
    "common.retry": "重试",
    "common.edit": "编辑",
    "common.loading": "加载中…",
    "common.download": "下载",
    "common.import": "导入",
    "common.export": "导出",
    "common.actions": "操作",
    "common.back": "返回",
    "common.copy": "复制链接",
    "language.toggle": "切换语言",
    "language.next": "EN",
    "view.timeline": "时间线",
    "view.archive": "归档",
    "view.trash": "回收站",
    "sidebar.navigation": "导航",
    "sidebar.title": "侧边栏",
    "sidebar.mobileDescription": "打开导航侧边栏。",
    "sidebar.toggle": "切换侧边栏",
    "composer.ariaLabel": "新记录",
    "composer.placeholder": "此刻在想什么？记下来…",
    "composer.addAttachment": "添加附件",
    "composer.addTag": "添加标签",
    "composer.bulletList": "列表",
    "composer.removeFile": "移除 {filename}",
    "visibility.private": "私密",
    "visibility.protected": "受保护",
    "visibility.public": "公开",
    "memo.restore": "恢复",
    "memo.pin": "置顶",
    "memo.unpin": "取消置顶",
    "memo.moveToTimeline": "移回时间线",
    "memo.share": "分享",
    "memo.moveToTrash": "移到回收站",
    "memo.deleteForever": "彻底删除",
    "memo.deleteConfirmTitle": "彻底删除这条记录？",
    "memo.deleteConfirmDescription":
      "删除后无法恢复，相关分享和关系也会一并移除。",
    "memo.stateArchived": "已归档",
    "memo.stateTrashed": "回收站",
    "memo.stateDeleted": "已删除",
    "list.emptyTitle": "这里还空着",
    "list.emptyDescription": "在上方写下第一条记录，或者调整筛选条件。",
    "list.errorTitle": "内容加载失败",
    "list.errorDescription": "网络恢复后再试一次。",
    "list.loadMore": "加载更多",
    "list.loadingMore": "加载中",
    "explorer.overview": "概览",
    "explorer.records": "记录",
    "explorer.tags": "标签",
    "explorer.days": "天",
    "explorer.words": "字数",
    "explorer.heatmap": "热力图",
    "explorer.recentWeeks": "最近 12 周",
    "explorer.monthApr": "四月",
    "explorer.monthMay": "五月",
    "explorer.monthJun": "六月",
    "explorer.all": "全部",
    "explorer.noTags": "还没有标签，用 #标签 开始整理",
    "explorer.heatmapDay": "{date}: {count}",
    "explorer.heatmapSummary": "最近 {days} 天共记录 {count} 条",
    "share.title": "分享",
    "share.unavailable": "分享不可用。",
    "share.unavailableDescription":
      "链接可能已过期、被撤销或对应记录不可公开访问。",
    "detail.content": "内容",
    "detail.relations": "关联",
    "detail.history": "历史",
    "detail.sharing": "分享",
    "detail.unavailable": "记录不可用",
    "detail.outgoing": "关联记录",
    "detail.backlinks": "反向链接",
    "detail.noRelations": "暂无关联",
    "detail.relatedMemoPlaceholder": "搜索记录内容或输入记录 ID",
    "detail.addRelation": "添加",
    "detail.searchingRelations": "正在搜索记录...",
    "detail.noRelationCandidates": "没有找到可关联的记录",
    "detail.removeRelation": "移除与“{content}”的关联",
    "detail.noRevisions": "还没有历史版本",
    "detail.restoreRevision": "恢复此版本",
    "detail.noShares": "暂无有效分享",
    "detail.createShare": "创建分享",
    "detail.revokeShare": "撤销分享",
    "toast.accessRequired": "登录状态已失效，请重新登录",
    "auth.sessionSecurity":
      "登录状态仅保存在安全的 HttpOnly Cookie 中，FlareMo 不会将会话令牌保存到本地存储。",
    "auth.nativeAccess": "原生访问",
    "auth.loginTitle": "登录 FlareMo",
    "auth.loginDescription": "使用你的 FlareMo 用户名和密码继续。",
    "auth.username": "用户名",
    "auth.password": "密码",
    "auth.signIn": "登录",
    "auth.signingIn": "正在登录…",
    "auth.loginFailed": "登录失败，请检查用户名和密码后重试。",
    "auth.statusUnavailable": "无法读取当前认证状态，请检查网络后重试。",
    "auth.setupUnavailable": "初始化暂不可用。请确认管理员已安全配置原生认证。",
    "auth.recoveryRequired":
      "初始化需要管理员恢复。为避免创建第二个 owner，系统已安全关闭初始化。",
    "auth.oneTimeSetup": "一次性初始化",
    "auth.setupTitle": "创建首个工作区账户",
    "auth.setupDescription":
      "此页面只在实例尚未初始化时可用，完成后将永久关闭。",
    "auth.bootstrapSecret": "初始化密钥",
    "auth.setupSecretNotice":
      "初始化密钥只用于本次请求，不会保存到浏览器或 FlareMo 数据库。请从安全渠道获取它。",
    "auth.displayName": "显示名称",
    "auth.email": "邮箱",
    "auth.confirmPassword": "确认密码",
    "auth.passwordLength": "密码至少需要 12 个字符。",
    "auth.passwordMismatch": "两次输入的密码不一致。",
    "auth.completeSetup": "完成初始化",
    "auth.settingUp": "正在初始化…",
    "auth.setupFailed":
      "初始化失败。请检查输入；若已部分完成，请联系管理员恢复。",
    "auth.accountTitle": "账户与访问",
    "auth.backToWorkspace": "返回工作区",
    "auth.signOut": "退出登录",
    "auth.profileTitle": "用户名",
    "auth.profileDescription": "用户名用于后续登录；修改后立即生效。",
    "auth.saveUsername": "保存用户名",
    "auth.saving": "正在保存…",
    "auth.usernameUpdateFailed": "无法更新用户名。",
    "auth.passwordTitle": "修改密码",
    "auth.passwordDescription": "修改后会撤销该账户在其他设备上的会话。",
    "auth.currentPassword": "当前密码",
    "auth.newPassword": "新密码",
    "auth.changePassword": "修改密码",
    "auth.passwordUpdateFailed": "无法修改密码。请确认当前密码后重试。",
    "auth.tokensTitle": "个人访问令牌",
    "auth.tokensDescription":
      "令牌用于 Memos 兼容客户端、脚本和 MCP。它们不会获得浏览器会话，也可以单独撤销。",
    "auth.tokenShownOnce": "请立即安全保存这个令牌",
    "auth.tokenShownOnceDescription":
      "出于安全原因，关闭此提示后无法再次查看完整令牌。",
    "auth.copyToken": "复制令牌",
    "auth.copied": "已复制",
    "auth.hideToken": "关闭并隐藏",
    "auth.copyFailed": "无法复制令牌，请手动安全保存。",
    "auth.tokenName": "令牌名称",
    "auth.tokenNamePlaceholder": "例如：Memos Desktop",
    "auth.tokenExpiry": "有效期（天）",
    "auth.never": "永不过期",
    "auth.tokenValidation": "请填写名称；有效期留空或填写 1 到 365 的整数。",
    "auth.createToken": "创建令牌",
    "auth.creatingToken": "正在创建…",
    "auth.tokenCreateFailed": "无法创建令牌。",
    "auth.tokensLoadFailed": "无法加载个人访问令牌。",
    "auth.noTokens": "还没有个人访问令牌。",
    "auth.unnamedToken": "未命名令牌",
    "auth.active": "有效",
    "auth.revoked": "已撤销",
    "auth.expires": "过期时间",
    "auth.lastUsed": "最近使用",
    "auth.neverUsed": "从未使用",
    "auth.requestCount": "请求次数",
    "auth.revokeToken": "撤销",
    "auth.tokenRevokeFailed": "无法撤销令牌。",
    "toast.untitledAttachment": "未命名附件",
    "toast.saved": "已保存",
    "toast.movedToTrash": "已移到回收站",
    "toast.restored": "已恢复",
    "toast.updated": "已更新",
    "toast.deleted": "已删除",
    "toast.shareCreated": "已创建分享",
    "toast.shareRevoked": "已撤销分享",
    "toast.revisionRestored": "已恢复历史版本",
    "toast.relationAdded": "已添加关联",
    "toast.relationRemoved": "已移除关联",
    "toast.copied": "链接已复制",
    "toast.imported": "已导入 {count} 条",
    "toast.invalidImport": "导入文件不是有效的 JSON",
    "toast.draftRestored": "已恢复未完成的草稿",
    "toast.queuedForSync": "当前离线，记录会在联网后自动保存",
    "toast.queueSynced": "离线记录已保存",
    "toast.queueNeedsAttention":
      "有 {count} 条离线记录尚无法提交；恢复网络或访问权限后会继续重试",
    "toast.offlineStorageUnavailable": "无法在此设备上保存离线记录",
    "toast.memoTooLong": "记录内容不能超过 100,000 个字符",
    "toast.tooManyAttachments": "一条记录最多添加 100 个附件",
    "toast.attachmentTooLarge": "单个附件不能超过 25 MiB",
    "toast.statsUnavailable": "概览暂时无法加载",
    "update.open": "系统更新",
    "update.title": "系统更新",
    "update.version": "版本",
    "update.available": "有新版本",
    "update.availableDescription":
      "升级会先进入你的部署仓库，确认合并后由 Cloudflare 自动发布。",
    "update.currentDescription": "查看当前版本和最新稳定版本。",
    "update.current": "当前版本",
    "update.latest": "最新版本",
    "update.published": "发布时间",
    "update.unavailable": "暂时无法检查",
    "update.repositoryNotConfigured": "尚未配置部署仓库，当前会打开升级指南。",
    "update.releaseNotes": "版本说明",
    "update.goToUpdate": "前往更新",
    "update.guide": "升级指南",
  },
  "en-US": {
    "app.name": "FlareMo",
    "common.search": "Search",
    "search.placeholder": "Search notes…",
    "search.results": "Search results",
    "search.globalScope": "Searching timeline and archive",
    "search.syntaxHint":
      "Filters: has:attachment · is:pinned · before:2026-07-01 · after:2026-07-01 · in:archive",
    "common.clearFilters": "Clear filters",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.retry": "Retry",
    "common.edit": "Edit",
    "common.loading": "Loading…",
    "common.download": "Download",
    "common.import": "Import",
    "common.export": "Export",
    "common.actions": "Actions",
    "common.back": "Back",
    "common.copy": "Copy link",
    "language.toggle": "Switch language",
    "language.next": "中",
    "view.timeline": "Timeline",
    "view.archive": "Archive",
    "view.trash": "Trash",
    "sidebar.navigation": "Navigation",
    "sidebar.title": "Sidebar",
    "sidebar.mobileDescription": "Opens the navigation sidebar.",
    "sidebar.toggle": "Toggle sidebar",
    "composer.ariaLabel": "New note",
    "composer.placeholder": "What's on your mind? Jot it down…",
    "composer.addAttachment": "Add attachment",
    "composer.addTag": "Add tag",
    "composer.bulletList": "Bullet list",
    "composer.removeFile": "Remove {filename}",
    "visibility.private": "Private",
    "visibility.protected": "Protected",
    "visibility.public": "Public",
    "memo.restore": "Restore",
    "memo.pin": "Pin",
    "memo.unpin": "Unpin",
    "memo.moveToTimeline": "Move to timeline",
    "memo.share": "Share",
    "memo.moveToTrash": "Move to trash",
    "memo.deleteForever": "Delete forever",
    "memo.deleteConfirmTitle": "Delete this note forever?",
    "memo.deleteConfirmDescription":
      "This cannot be undone. Related shares and relations will also be removed.",
    "memo.stateArchived": "Archived",
    "memo.stateTrashed": "Trash",
    "memo.stateDeleted": "Deleted",
    "list.emptyTitle": "Nothing here yet",
    "list.emptyDescription":
      "Write your first note above, or adjust the filters.",
    "list.errorTitle": "Could not load notes",
    "list.errorDescription": "Check your connection and try again.",
    "list.loadMore": "Load more",
    "list.loadingMore": "Loading",
    "explorer.overview": "Overview",
    "explorer.records": "Notes",
    "explorer.tags": "Tags",
    "explorer.days": "Days",
    "explorer.words": "Words",
    "explorer.heatmap": "Activity",
    "explorer.recentWeeks": "Last 12 weeks",
    "explorer.monthApr": "Apr",
    "explorer.monthMay": "May",
    "explorer.monthJun": "Jun",
    "explorer.all": "All",
    "explorer.noTags": "No tags yet — start organizing with #tag",
    "explorer.heatmapDay": "{date}: {count}",
    "explorer.heatmapSummary": "{count} notes in the last {days} days",
    "share.title": "Share",
    "share.unavailable": "This share is unavailable.",
    "share.unavailableDescription":
      "The link may have expired, been revoked, or point to a note that is no longer public.",
    "detail.content": "Content",
    "detail.relations": "Links",
    "detail.history": "History",
    "detail.sharing": "Sharing",
    "detail.unavailable": "Note unavailable",
    "detail.outgoing": "Related notes",
    "detail.backlinks": "Backlinks",
    "detail.noRelations": "No links yet",
    "detail.relatedMemoPlaceholder": "Search note content or enter a note ID",
    "detail.addRelation": "Add",
    "detail.searchingRelations": "Searching notes...",
    "detail.noRelationCandidates": "No notes found to link",
    "detail.removeRelation": "Remove link to “{content}”",
    "detail.noRevisions": "No revisions yet",
    "detail.restoreRevision": "Restore",
    "detail.noShares": "No active shares",
    "detail.createShare": "Create share",
    "detail.revokeShare": "Revoke share",
    "toast.accessRequired": "Your sign-in has expired. Please sign in again.",
    "auth.sessionSecurity":
      "Your session is held only in a secure HttpOnly cookie. FlareMo never stores session tokens in local storage.",
    "auth.nativeAccess": "Native access",
    "auth.loginTitle": "Sign in to FlareMo",
    "auth.loginDescription":
      "Continue with your FlareMo username and password.",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.signIn": "Sign in",
    "auth.signingIn": "Signing in…",
    "auth.loginFailed":
      "Sign-in failed. Check your username and password, then try again.",
    "auth.statusUnavailable":
      "FlareMo could not read the current authentication status. Check your connection and try again.",
    "auth.setupUnavailable":
      "Setup is unavailable. Confirm that an administrator has securely configured native authentication.",
    "auth.recoveryRequired":
      "Setup requires administrator recovery. To avoid creating a second owner, FlareMo has safely closed setup.",
    "auth.oneTimeSetup": "One-time setup",
    "auth.setupTitle": "Create the first workspace account",
    "auth.setupDescription":
      "This page is available only while the instance is uninitialized and permanently closes after setup.",
    "auth.bootstrapSecret": "Setup secret",
    "auth.setupSecretNotice":
      "The setup secret is used only for this request. It is not saved in your browser or in FlareMo's database. Obtain it through a secure channel.",
    "auth.displayName": "Display name",
    "auth.email": "Email",
    "auth.confirmPassword": "Confirm password",
    "auth.passwordLength": "Passwords must be at least 12 characters long.",
    "auth.passwordMismatch": "The two passwords do not match.",
    "auth.completeSetup": "Complete setup",
    "auth.settingUp": "Setting up…",
    "auth.setupFailed":
      "Setup could not finish. Check the input; if it partially completed, ask an administrator to recover it.",
    "auth.accountTitle": "Account and access",
    "auth.backToWorkspace": "Back to workspace",
    "auth.signOut": "Sign out",
    "auth.profileTitle": "Username",
    "auth.profileDescription":
      "Your username is used for future sign-ins and takes effect immediately when changed.",
    "auth.saveUsername": "Save username",
    "auth.saving": "Saving…",
    "auth.usernameUpdateFailed": "Could not update the username.",
    "auth.passwordTitle": "Change password",
    "auth.passwordDescription":
      "Changing the password revokes this account's sessions on other devices.",
    "auth.currentPassword": "Current password",
    "auth.newPassword": "New password",
    "auth.changePassword": "Change password",
    "auth.passwordUpdateFailed":
      "Could not change the password. Check the current password and try again.",
    "auth.tokensTitle": "Personal access tokens",
    "auth.tokensDescription":
      "Tokens are for Memos-compatible clients, scripts, and MCP. They do not grant a browser session and can be revoked independently.",
    "auth.tokenShownOnce": "Save this token securely now",
    "auth.tokenShownOnceDescription":
      "For security, the complete token cannot be viewed again after you hide this notice.",
    "auth.copyToken": "Copy token",
    "auth.copied": "Copied",
    "auth.hideToken": "Hide token",
    "auth.copyFailed":
      "FlareMo could not copy the token. Save it securely by hand.",
    "auth.tokenName": "Token name",
    "auth.tokenNamePlaceholder": "For example: Memos Desktop",
    "auth.tokenExpiry": "Expires in days",
    "auth.never": "Never",
    "auth.tokenValidation":
      "Enter a name and leave expiry blank or enter a whole number from 1 to 365.",
    "auth.createToken": "Create token",
    "auth.creatingToken": "Creating…",
    "auth.tokenCreateFailed": "Could not create the token.",
    "auth.tokensLoadFailed": "Could not load personal access tokens.",
    "auth.noTokens": "No personal access tokens yet.",
    "auth.unnamedToken": "Unnamed token",
    "auth.active": "Active",
    "auth.revoked": "Revoked",
    "auth.expires": "Expires",
    "auth.lastUsed": "Last used",
    "auth.neverUsed": "Never used",
    "auth.requestCount": "Requests",
    "auth.revokeToken": "Revoke",
    "auth.tokenRevokeFailed": "Could not revoke the token.",
    "toast.untitledAttachment": "Untitled attachment",
    "toast.saved": "Saved",
    "toast.movedToTrash": "Moved to trash",
    "toast.restored": "Restored",
    "toast.updated": "Updated",
    "toast.deleted": "Deleted",
    "toast.shareCreated": "Share created",
    "toast.shareRevoked": "Share revoked",
    "toast.revisionRestored": "Revision restored",
    "toast.relationAdded": "Link added",
    "toast.relationRemoved": "Link removed",
    "toast.copied": "Link copied",
    "toast.imported": "Imported {count} notes",
    "toast.invalidImport": "The import file is not valid JSON",
    "toast.draftRestored": "Restored your unfinished draft",
    "toast.queuedForSync":
      "You are offline. This note will save automatically when connected.",
    "toast.queueSynced": "Offline note saved",
    "toast.queueNeedsAttention":
      "{count} offline note(s) still need attention and will retry when access or connectivity returns.",
    "toast.offlineStorageUnavailable":
      "This device cannot store the note for offline sync.",
    "toast.memoTooLong": "A note cannot exceed 100,000 characters",
    "toast.tooManyAttachments": "A note can have at most 100 attachments",
    "toast.attachmentTooLarge": "Each attachment must be 25 MiB or smaller",
    "toast.statsUnavailable": "Overview is temporarily unavailable",
    "update.open": "System update",
    "update.title": "System update",
    "update.version": "Version",
    "update.available": "Update available",
    "update.availableDescription":
      "The update is prepared in your deployment repository. Merge it there and Cloudflare will publish it automatically.",
    "update.currentDescription":
      "Review the installed and latest stable versions.",
    "update.current": "Installed",
    "update.latest": "Latest",
    "update.published": "Published",
    "update.unavailable": "Check unavailable",
    "update.repositoryNotConfigured":
      "The deployment repository is not configured, so the update guide will open instead.",
    "update.releaseNotes": "Release notes",
    "update.goToUpdate": "Go to update",
    "update.guide": "Update guide",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type TranslationKey = keyof (typeof messages)["zh-CN"];
type TranslationParams = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: TranslationKey, params?: TranslationParams) =>
      interpolate(messages[locale][key], params);
    const toggleLocale = () =>
      setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"));
    return { locale, setLocale, toggleLocale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider.");
  }
  return context;
}

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    String(params[key] ?? match),
  );
}
