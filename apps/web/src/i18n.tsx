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
    "common.clearFilters": "清除筛选",
    "common.save": "保存",
    "common.cancel": "取消",
    "common.retry": "重试",
    "common.edit": "编辑",
    "common.loading": "加载中...",
    "common.download": "下载",
    "common.import": "导入",
    "common.export": "导出",
    "common.actions": "操作",
    "language.toggle": "切换语言",
    "language.next": "EN",
    "view.timeline": "时间线",
    "view.archive": "归档",
    "view.trash": "回收站",
    "sidebar.navigation": "导航",
    "sidebar.title": "侧边栏",
    "sidebar.mobileDescription": "显示移动端侧边栏。",
    "sidebar.toggle": "切换侧边栏",
    "composer.ariaLabel": "新记录",
    "composer.placeholder": "现在的想法是...",
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
    "list.emptyTitle": "暂无内容",
    "list.emptyDescription": "",
    "list.errorTitle": "内容加载失败",
    "list.errorDescription": "连接恢复后可以重新加载。",
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
    "explorer.noTags": "还没有标签",
    "explorer.heatmapDay": "{date}: {count}",
    "explorer.heatmapSummary": "最近 {days} 天共记录 {count} 条",
    "share.title": "分享",
    "share.unavailable": "分享不可用。",
    "toast.accessRequired": "需要通过 Cloudflare Access 访问",
    "toast.untitledAttachment": "未命名附件",
    "toast.saved": "已保存",
    "toast.movedToTrash": "已移到回收站",
    "toast.restored": "已恢复",
    "toast.updated": "已更新",
    "toast.deleted": "已删除",
    "toast.shareCreated": "已创建分享",
    "toast.imported": "已导入 {count} 条",
    "toast.invalidImport": "导入文件不是有效的 JSON",
    "toast.statsUnavailable": "概览暂时无法加载",
  },
  "en-US": {
    "app.name": "FlareMo",
    "common.search": "Search",
    "common.clearFilters": "Clear filters",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.retry": "Retry",
    "common.edit": "Edit",
    "common.loading": "Loading...",
    "common.download": "Download",
    "common.import": "Import",
    "common.export": "Export",
    "common.actions": "Actions",
    "language.toggle": "Switch language",
    "language.next": "中",
    "view.timeline": "Timeline",
    "view.archive": "Archive",
    "view.trash": "Trash",
    "sidebar.navigation": "Navigation",
    "sidebar.title": "Sidebar",
    "sidebar.mobileDescription": "Shows the mobile sidebar.",
    "sidebar.toggle": "Toggle sidebar",
    "composer.ariaLabel": "New note",
    "composer.placeholder": "What is on your mind...",
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
    "list.emptyTitle": "No content",
    "list.emptyDescription": "",
    "list.errorTitle": "Could not load notes",
    "list.errorDescription": "Retry when the connection is available.",
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
    "explorer.noTags": "No tags yet",
    "explorer.heatmapDay": "{date}: {count}",
    "explorer.heatmapSummary": "{count} notes in the last {days} days",
    "share.title": "Share",
    "share.unavailable": "This share is unavailable.",
    "toast.accessRequired": "Cloudflare Access session required",
    "toast.untitledAttachment": "Untitled attachment",
    "toast.saved": "Saved",
    "toast.movedToTrash": "Moved to trash",
    "toast.restored": "Restored",
    "toast.updated": "Updated",
    "toast.deleted": "Deleted",
    "toast.shareCreated": "Share created",
    "toast.imported": "Imported {count} notes",
    "toast.invalidImport": "The import file is not valid JSON",
    "toast.statsUnavailable": "Overview is temporarily unavailable",
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
