import { Link } from "@tanstack/react-router";
import { PinIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Memo, MemoVisibility, Share } from "@/api";
import { MemoVisibilityDialog } from "@/components/memo-visibility-dialog";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime, formatMemoTime } from "@/lib/memo";
import { VisibilityBadge, VoiceBadge } from "./memo-card-badges";
import { MemoCardMenu } from "./memo-card-menu";

type MemoCardHeaderProps = {
  /** The comment toggle, first in the trailing cluster. */
  commentAction?: ReactNode;
  memo: Memo;
  id: string;
  isTrashed: boolean;
  canManage: boolean;
  canGovern: boolean;
  /** Warms the detail route's queries; wired to the title link's hover. */
  prefetchDetail: () => void;
  onArchive: (id: string) => void;
  onHardDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => void;
  onRestore: (id: string) => void;
  onStartEditing: () => void;
  onTrash: (id: string) => void;
  share?: Share;
  onShare: (id: string) => Promise<Share>;
  onRevokeShare?: (share: Share) => void;
  onUpdateVisibility: (visibility: MemoVisibility) => Promise<void>;
  onRequestDelete?: (memo: Memo) => void;
  onRequestShareImage?: (memo: Memo) => void;
  onRequestVisibility?: (memo: Memo) => void;
};

/**
 * The card's identity row — timestamp, author, badges, ⋯ menu — and the
 * visibility dialog both the badge and the menu item open. The dialog is
 * dual-channel: a list that manages visibility itself renders one singleton
 * instead, so the card keeps none.
 */
export function MemoCardHeader({
  commentAction,
  memo,
  id,
  isTrashed,
  canManage,
  canGovern,
  prefetchDetail,
  onArchive,
  onHardDelete,
  onPin,
  onRestore,
  onStartEditing,
  onTrash,
  share,
  onShare,
  onRevokeShare,
  onUpdateVisibility,
  onRequestDelete,
  onRequestShareImage,
  onRequestVisibility,
}: MemoCardHeaderProps) {
  const { locale, t } = useI18n();
  const [isVisibilityOpen, setIsVisibilityOpen] = useState(false);
  return (
    <>
      <div className="flex w-full items-center justify-between gap-2">
        <Link
          className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onFocus={prefetchDetail}
          onMouseEnter={prefetchDetail}
          params={{ memoId: memo.id }}
          to="/memo/$memoId"
        >
          {/* In a shared space the author comes first, the way a post
              reads ("Kim · 3 分钟前"); a personal note has no audience
              besides its author, so the name is noise there. */}
          {memo.visibility !== "private" && memo.creator_name && (
            <span className="shrink-0 font-medium text-foreground/80">
              {memo.creator_name}
              <span className="ms-2 font-normal text-muted-foreground">·</span>
            </span>
          )}
          {/* flomo's header rule: identity only, no placeholders. The
              timestamp is the sole anchor; hovering swaps relative for the
              absolute instant, so both facts live in one pixel row. */}
          <span className="inline-grid [grid-template-areas:'stack'] items-center justify-items-start truncate">
            <span className="[grid-area:stack] transition-opacity duration-150 group-hover:opacity-0 pointer-events-none">
              {formatMemoRelativeTime(memo.display_time, locale)}
            </span>
            <span className="[grid-area:stack] opacity-0 transition-opacity duration-150 group-hover:opacity-100 whitespace-nowrap">
              {formatMemoTime(memo.display_time, locale)}
            </span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {commentAction}
          {memo.pinned && memo.state === "normal" && (
            <span
              className="inline-flex size-6 items-center justify-center text-muted-foreground"
              title={t("memo.pinned")}
            >
              <PinIcon aria-label={t("memo.pinned")} className="size-3.5" />
            </span>
          )}
          {memo.source === "voice" && <VoiceBadge memo={memo} />}
          {memo.visibility !== "private" && (
            <VisibilityBadge
              visibility={memo.visibility}
              onClick={() =>
                onRequestVisibility
                  ? onRequestVisibility(memo)
                  : setIsVisibilityOpen(true)
              }
            />
          )}
          <MemoCardMenu
            memo={memo}
            id={id}
            isTrashed={isTrashed}
            canManage={canManage}
            canGovern={canGovern}
            onArchive={onArchive}
            onHardDelete={onHardDelete}
            onPin={onPin}
            onRestore={onRestore}
            onStartEditing={onStartEditing}
            onTrash={onTrash}
            onOpenVisibility={() => setIsVisibilityOpen(true)}
            onRequestDelete={onRequestDelete}
            onRequestShareImage={onRequestShareImage}
            onRequestVisibility={onRequestVisibility}
          />
        </div>
      </div>
      {!onRequestVisibility && (
        <MemoVisibilityDialog
          memo={memo}
          open={isVisibilityOpen}
          onOpenChange={setIsVisibilityOpen}
          onRevokeShare={onRevokeShare}
          onShare={onShare}
          onUpdateVisibility={onUpdateVisibility}
          share={share}
        />
      )}
    </>
  );
}
