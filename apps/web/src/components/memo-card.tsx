import type { Editor } from "@tiptap/react";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import type { Attachment, Memo, MemoVisibility, Share } from "@/api";
import {
  canOpenMemoThread,
  MemoCardBody,
  MemoCommentButton,
} from "@/components/memo-card/memo-card-body";
import { MemoCardEditor } from "@/components/memo-card/memo-card-editor";
import { MemoCardHeader } from "@/components/memo-card/memo-card-header";
import { useMemoCardActions } from "@/components/memo-card/use-memo-card-actions";
import { MemoComments } from "@/components/memo-comments";
import { cn } from "@/lib/utils";

type MemoCardProps = {
  memo: Memo;
  attachments: Attachment[];
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  /** Creates (or reuses) the memo's public share and resolves with it, so a
      caller that has no share yet can still obtain the token in one step. */
  onShare: (id: string) => Promise<Share>;
  /** Tear down the public link after a memo leaves "public". */
  onRevokeShare?: (share: Share) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => Promise<void>;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onHardDelete: (id: string) => Promise<void>;
  share?: Share;
  searchQuery?: string;
  /** Position in the list, used to stagger the entrance animation. */
  index?: number;
  /** Called when a tag chip is clicked to filter the timeline by that tag. */
  onTagClick?: (tag: string) => void;
  canManage?: boolean;
  /** Lifecycle governance (archive/trash/restore) without content editing. */
  canGovern?: boolean;
  /** Focused via J/K keyboard navigation. */
  isFocused?: boolean;
  onRequestDelete?: (memo: Memo) => void;
  onRequestShareImage?: (memo: Memo) => void;
  onRequestVisibility?: (memo: Memo) => void;
  /**
   * Reports whether this card holds unsaved editor state. The virtualized
   * timeline uses it to keep such a card mounted: unmounting mid-edit would
   * discard the draft the user is still typing.
   */
  onEditingChange?: (memoName: string, editing: boolean) => void;
  /** The workspace has a team someone else is in: every live card can be
      commented on in place. */
  commentsEnabled?: boolean;
};

/**
 * Threads the reader opened, by memo id. The virtualized timeline remounts
 * cards as they scroll back into view; an open thread stays open.
 */
const openThreads = new Set<string>();

export const MemoCard = memo(function MemoCard({
  memo,
  attachments,
  onArchive,
  onPin,
  onShare,
  onRevokeShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
  share,
  searchQuery,
  index = 0,
  onTagClick,
  canManage = false,
  canGovern = false,
  isFocused = false,
  onRequestDelete,
  onRequestShareImage,
  onRequestVisibility,
  onEditingChange,
  commentsEnabled = false,
}: MemoCardProps) {
  // Expansion is per-card and resets on remount; it outlives an edit
  // round-trip, so it stays above the body/editor switch.
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingInline, setIsUploadingInline] = useState(false);
  const [draftContent, setDraftContent] = useState(memo.content);
  // Card-owned, like the states above: an upload that outlives the editor
  // session (Esc while a paste is still settling) keeps its target.
  const editEditorRef = useRef<Editor | null>(null);
  const isTrashed = memo.state === "trashed";
  const [commentsOpen, setCommentsOpen] = useState(() =>
    openThreads.has(memo.id),
  );
  // Focus the reply box only when the reader just opened the thread, not
  // when a remount restores it.
  const [focusReply, setFocusReply] = useState(false);
  const toggleComments = useCallback(() => {
    setCommentsOpen((open) => {
      const next = !open;
      if (next) openThreads.add(memo.id);
      else openThreads.delete(memo.id);
      return next;
    });
    setFocusReply(true);
  }, [memo.id]);

  // The virtualized list may unmount a card at any scroll offset. While the
  // editor is open that would throw away the draft, so every write to
  // `isEditing` — including the one inside useMemoCardActions' save path —
  // goes through this wrapper, which reports the state to the list.
  // The report happens beside the state write, not inside an updater:
  // updaters run during render, and setting the list's state from there is
  // React's "cannot update a component while rendering another" error.
  const editingRef = useRef(false);
  const setEditing = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      const previous = editingRef.current;
      const next = typeof value === "function" ? value(previous) : value;
      if (next === previous) return;
      editingRef.current = next;
      setIsEditing(next);
      onEditingChange?.(memo.name, next);
    },
    [memo.name, onEditingChange],
  );

  const { changeVisibility, id, prefetchDetail, saveEditing, taskInteraction } =
    useMemoCardActions({
      canManage,
      draftContent,
      isTrashed,
      memo,
      onRevokeShare,
      onShare,
      onUpdate,
      share,
      setIsEditing: setEditing,
      setIsSaving,
    });

  const canOpenThread = canOpenMemoThread(memo, commentsEnabled);

  const startEditing = () => {
    setDraftContent(memo.content);
    setEditing(true);
  };

  const stopEditing = () => setEditing(false);
  const beginEditing = startEditing;

  return (
    <article
      data-memo-id={memo.id}
      className={cn(
        "paper group relative flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-card-foreground shadow-xs [content-visibility:auto] [contain-intrinsic-size:auto_120px] motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-border hover:shadow-sm sm:px-5 sm:py-4",
        // Pinned: a slim inset ember bar (one of the four places the brand
        // gradient is allowed), instead of a thick colored border.
        memo.pinned &&
          "before:pointer-events-none before:absolute before:inset-y-4 before:start-0 before:w-[3px] before:rounded-e-full before:bg-brand-gradient",
        isFocused && "border-ring/60 ring-3 ring-ring/20",
        isEditing && "border-ring/50 shadow-sm ring-3 ring-ring/15",
      )}
      style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}
    >
      <MemoCardHeader
        commentAction={
          canOpenThread ? (
            <MemoCommentButton
              count={memo.comment_count ?? 0}
              open={commentsOpen}
              onToggle={toggleComments}
            />
          ) : null
        }
        memo={memo}
        id={id}
        isTrashed={isTrashed}
        canManage={canManage}
        canGovern={canGovern}
        prefetchDetail={prefetchDetail}
        onArchive={onArchive}
        onHardDelete={onHardDelete}
        onPin={onPin}
        onRestore={onRestore}
        onStartEditing={beginEditing}
        onTrash={onTrash}
        share={share}
        onShare={onShare}
        onRevokeShare={onRevokeShare}
        onUpdateVisibility={changeVisibility}
        onRequestDelete={onRequestDelete}
        onRequestShareImage={onRequestShareImage}
        onRequestVisibility={onRequestVisibility}
      />
      {isEditing ? (
        <MemoCardEditor
          content={draftContent}
          isSaving={isSaving}
          isUploadingInline={isUploadingInline}
          setIsUploadingInline={setIsUploadingInline}
          editorRef={editEditorRef}
          memoName={memo.name}
          onCancel={stopEditing}
          onContentChange={setDraftContent}
          onSave={saveEditing}
        />
      ) : (
        <MemoCardBody
          attachments={attachments}
          canManage={canManage}
          expanded={expanded}
          memo={memo}
          onTagClick={onTagClick}
          onToggleExpanded={() => setExpanded((value) => !value)}
          searchQuery={searchQuery}
          taskInteraction={taskInteraction}
          canOpenThread={canOpenThread}
        />
      )}
      {commentsOpen && !isEditing && canOpenThread && (
        <MemoComments
          autoFocus={focusReply}
          canComment
          memoId={memo.id}
          mentions={commentsEnabled && memo.visibility !== "private"}
          variant="inline"
        />
      )}
    </article>
  );
});
