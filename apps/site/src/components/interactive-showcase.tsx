import { useEffect, useState } from "react";
import type { ShowcaseContent } from "@/content/showcase-i18n";
import { DesktopDevice } from "./showcase/desktop-device";
import {
  createInitialMemos,
  type Memo,
  type ShowcaseMenu,
} from "./showcase/fixtures";
import { MobileDevice } from "./showcase/mobile-device";

export function InteractiveShowcase({
  showcase,
}: {
  showcase: ShowcaseContent;
}) {
  const [memos, setMemos] = useState<Memo[]>(() =>
    createInitialMemos(showcase),
  );
  const [activeMenu, setActiveMenu] = useState<ShowcaseMenu>("timeline");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 当外部语言切换时，重置并切换默认展示内容
  useEffect(() => {
    setMemos(createInitialMemos(showcase));
    setActiveTag(null);
  }, [showcase]);

  const [timeViewTab, setTimeViewTab] = useState<"trend" | "calendar">("trend");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [presetIndex, setPresetIndex] = useState(0);

  // 输入框草稿与同步状态
  const [desktopInput, setDesktopInput] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedId, setLastSyncedId] = useState<string | null>(null);

  const totalCount = memos.length + 63;
  const tagList = showcase.ui.tags;

  // 发布新笔记
  const publishMemo = (rawText: string, fromMobile = false) => {
    let text = rawText.trim();
    if (!text) {
      const presets = showcase.presets;
      text = presets[presetIndex % presets.length].text;
      setPresetIndex((prev) => prev + 1);
    }

    setIsSyncing(true);

    const extractedTags = Array.from(
      new Set(
        (text.match(/#([\w\u4e00-\u9fa5]+)/g) || []).map((t) =>
          t.replace("#", ""),
        ),
      ),
    );
    const tags =
      extractedTags.length > 0
        ? extractedTags
        : [showcase.ui.tags[2]?.name || "ideas"];

    const matchedPreset = showcase.presets.find((p) => p.text === text);
    const title =
      matchedPreset?.title ??
      (text.length > 18 ? `${text.slice(0, 16)}...` : text);
    const quote = matchedPreset?.quote;
    const cleanContent = text.replace(/#([\w\u4e00-\u9fa5]+)/g, "").trim();

    const newId = `memo-${Date.now()}`;
    const nextOrder = memos.length > 0 ? memos[0].orderNumber + 1 : 66;

    setTimeout(() => {
      const newMemo: Memo = {
        id: newId,
        orderNumber: nextOrder,
        timeLabel: showcase.ui.justNow,
        title,
        content: cleanContent || text,
        quote,
        tags,
        isNew: true,
      };

      setMemos((prev) => [newMemo, ...prev]);
      setLastSyncedId(newId);
      if (fromMobile) setMobileInput("");
      else setDesktopInput("");
      setIsSyncing(false);
    }, 350);
  };

  const filteredMemos = memos.filter((m) => {
    if (activeTag && !m.tags.includes(activeTag)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // 双端共享的菜单 / 标签选择动作（抽屉额外关闭自身，时间线额外清空标签筛选）
  const selectMenu = (menu: ShowcaseMenu, closeDrawer = false) => {
    setActiveMenu(menu);
    if (menu === "timeline") setActiveTag(null);
    if (closeDrawer) setMobileDrawerOpen(false);
  };

  const toggleTag = (name: string) => {
    setActiveTag(activeTag === name ? null : name);
  };

  return (
    <section className="container-x">
      {/* 真实高对比双端硬件模型 */}
      <div className="grid gap-8 lg:grid-cols-[1fr_310px] xl:grid-cols-[1fr_330px] items-start">
        {/* ============================================================
            电脑端设备：高对比 MacBook 视窗底座
            ============================================================ */}
        <DesktopDevice
          showcase={showcase}
          totalCount={totalCount}
          tagList={tagList}
          activeMenu={activeMenu}
          activeTag={activeTag}
          timeViewTab={timeViewTab}
          searchQuery={searchQuery}
          filteredMemos={filteredMemos}
          lastSyncedId={lastSyncedId}
          composerValue={desktopInput}
          isSyncing={isSyncing}
          onSelectMenu={(menu) => selectMenu(menu)}
          onTimeViewTabChange={setTimeViewTab}
          onToggleTag={toggleTag}
          onSearchChange={setSearchQuery}
          onComposerValueChange={setDesktopInput}
          onPublish={() => publishMemo(desktopInput, false)}
        />

        {/* ============================================================
            手机端设备：高质感钛金属 / 极夜黑真实手机硬件模型
            ============================================================ */}
        <MobileDevice
          showcase={showcase}
          totalCount={totalCount}
          tagList={tagList}
          activeMenu={activeMenu}
          activeTag={activeTag}
          searchQuery={searchQuery}
          filteredMemos={filteredMemos}
          lastSyncedId={lastSyncedId}
          composerValue={mobileInput}
          isSyncing={isSyncing}
          drawerOpen={mobileDrawerOpen}
          onSelectMenu={(menu) => selectMenu(menu, true)}
          onToggleTag={(name) => {
            toggleTag(name);
            setMobileDrawerOpen(false);
          }}
          onSearchChange={setSearchQuery}
          onComposerValueChange={setMobileInput}
          onPublish={() => publishMemo(mobileInput, true)}
          onOpenDrawer={() => setMobileDrawerOpen(true)}
          onCloseDrawer={() => setMobileDrawerOpen(false)}
          onClearTag={() => setActiveTag(null)}
        />
      </div>
    </section>
  );
}
