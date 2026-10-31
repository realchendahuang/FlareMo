import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import type { Memo } from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import {
  isCollapsibleMemoContent,
  memoBodyClipClass,
} from "@/components/memo-card/memo-card-body";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import {
  createImageDimensionResolver,
  filterUnreferencedAttachments,
} from "@/lib/attachment-refs";
import { formatMemoTime, getMemoResourceId } from "@/lib/memo";

/** Read-only memo card used by review surfaces (daily review, random walk). */
export function MemoSnapshotCard({
  badge,
  children,
  locale,
  memo,
}: {
  badge?: string | null;
  /** Rendered at the bottom of the card, e.g. an inline comment thread. */
  children?: ReactNode;
  locale: string;
  memo: Memo;
}) {
  const { t } = useI18n();
  const id = getMemoResourceId(memo);
  const [expanded, setExpanded] = useState(false);
  const attachments = memo.attachments ?? [];
  // Same reading rules as the timeline card: a long body collapses, and
  // images the text already shows inline stay out of the gallery.
  const isCollapsible = useMemo(
    () => isCollapsibleMemoContent(memo.content),
    [memo.content],
  );
  const collapsed = isCollapsible && !expanded;
  const galleryAttachments = useMemo(
    () => filterUnreferencedAttachments(attachments, memo.content),
    [attachments, memo.content],
  );
  const resolveImageDimensions = useMemo(
    () => createImageDimensionResolver(attachments),
    [attachments],
  );
  return (
    <Card className="motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-border hover:shadow-xs">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            params={{ memoId: memo.id || id }}
            to="/memo/$memoId"
          >
            <time>
              {formatMemoTime(memo.display_time ?? memo.create_time, locale)}
            </time>
          </Link>
          {badge && <Badge variant="brand">{badge}</Badge>}
        </div>
        <div>
          <div className={memoBodyClipClass(collapsed)}>
            <LazyMemoContent
              content={memo.content}
              resolveImageDimensions={resolveImageDimensions}
            />
          </div>
          {isCollapsible && (
            <Button
              className="mt-1.5 -ms-2.5"
              onClick={() => setExpanded((value) => !value)}
              size="sm"
              variant="ghost"
            >
              {collapsed ? t("reading.expand") : t("reading.collapse")}
            </Button>
          )}
        </div>
        {galleryAttachments.length > 0 && (
          <AttachmentGallery attachments={galleryAttachments} />
        )}
        {children}
      </CardContent>
    </Card>
  );
}
