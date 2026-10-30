import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeftIcon,
  BoldIcon,
  CodeIcon,
  ExternalLinkIcon,
  EyeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  QuoteIcon,
  StrikethroughIcon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type Article,
  deleteArticle,
  getArticle,
  updateArticle,
  uploadAttachment,
} from "@/api";
import { ArticleEditor, extractImageFiles } from "@/components/article-editor";
import { ArticlePublishDialog } from "@/components/article-publish-dialog";
import { ArticleShikiBody } from "@/components/article-shiki-body";
import { QueryErrorState } from "@/components/query-error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { uploadAndInsertImages } from "@/lib/rich-editor-upload";
import { cn } from "@/lib/utils";

const AUTOSAVE_DEBOUNCE_MS = 2000;

type SaveState = "idle" | "dirty" | "saving" | "saved";

/**
 * The article editor surface. One article is one draft row: the list page's
 * create action allocates it up front (uploads bind articleId immediately, so
 * inline images survive the orphan GC), and every keystroke lands in a
 * 2s-debounced PATCH that also flushes on unmount / beforeunload.
 */
/**
 * Two bodies are the same article when they differ only in trailing blank
 * lines: TipTap re-serializes markdown on load (a list gains a closing blank
 * line), and saving that would bump updated_at on every open.
 */
function sameArticleBody(a: string, b: string) {
  return a.trimEnd() === b.trimEnd();
}

/** Characters of prose, the way Chinese writing is counted: markup and
 * whitespace do not count. */
function countArticleChars(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|\-[\]]/g, "")
    .replace(/\s+/g, "").length;
}

export function ArticleEditorPage({ articleId }: { articleId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const articleQuery = useQuery({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
    retry: false,
  });

  const article = articleQuery.data?.article;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [activeTools, setActiveTools] = useState<Partial<ArticleActiveTools>>(
    {},
  );
  // Runs on every transaction; keep the old object when nothing changed so
  // a caret move does not re-render the page.
  const syncActiveTools = (editor: Editor) => {
    const next = readArticleActiveTools(editor);
    setActiveTools((prev) =>
      ARTICLE_TOOL_STATES.every((key) => prev[key] === next[key]) ? prev : next,
    );
  };
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [savedArticle, setSavedArticle] = useState<Article | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef("");
  const contentRef = useRef("");
  const seededRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedArticleRef = useRef<Article | null>(null);
  savedArticleRef.current = savedArticle;
  const latestRef = useRef({ title: "", content: "" });

  useEffect(() => {
    if (!article || seededRef.current) return;
    seededRef.current = true;
    titleRef.current = article.title;
    contentRef.current = article.content;
    setTitle(article.title);
    setContent(article.content);
    setSavedArticle(article);
    latestRef.current = { title: article.title, content: article.content };
    setSaveState("saved");
  }, [article]);

  const saveMutation = useMutation({
    mutationFn: (patch: { title?: string; content?: string }) =>
      updateArticle(articleId, patch),
    onSuccess: ({ article: updated }) => {
      setSavedArticle(updated);
      setSaveState("saved");
      queryClient.setQueryData(["article", articleId], { article: updated });
    },
    onError: () => {
      toast.error(t("article.autosaveFailed"));
      setSaveState("dirty");
    },
  });
  // useMutation returns a fresh object every render (the spread), so the save
  // call goes through a ref: flushSave must keep a stable identity, or the
  // unmount effect below would re-run — and flush — on every keystroke,
  // defeating the debounce. mutateAsync itself is the observer's bound method
  // and is stable.
  const saveRef = useRef(saveMutation.mutateAsync);
  saveRef.current = saveMutation.mutateAsync;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = savedArticleRef.current;
    const next = latestRef.current;
    if (
      !current ||
      (next.title === current.title &&
        sameArticleBody(next.content, current.content))
    ) {
      // Nothing to persist. TipTap normalizes markdown on mount and the
      // resulting onUpdate schedules a save whose round-trip is a no-op;
      // leaving the indicator on "dirty" would show 未保存 forever for an
      // article that is fully saved.
      if (current) {
        setSaveState((state) => (state === "dirty" ? "saved" : state));
      }
      return;
    }
    setSaveState("saving");
    void saveRef
      .current({ title: next.title, content: next.content })
      .catch(() => undefined);
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    latestRef.current = {
      title: titleRef.current,
      content: contentRef.current,
    };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const keepaliveFlush = useCallback(() => {
    const next = latestRef.current;
    const current = savedArticleRef.current;
    if (
      !current ||
      (next.title === current.title &&
        sameArticleBody(next.content, current.content))
    ) {
      return;
    }
    void fetch(`/api/app/articles/${encodeURIComponent(articleId)}`, {
      body: JSON.stringify({ title: next.title, content: next.content }),
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "PATCH",
    });
  }, [articleId]);

  // Flush pending edits when leaving the editor or closing the tab.
  useEffect(() => {
    window.addEventListener("beforeunload", keepaliveFlush);
    return () => {
      window.removeEventListener("beforeunload", keepaliveFlush);
      flushSave();
    };
  }, [flushSave, keepaliveFlush]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteArticle(articleId),
    onSuccess: () => {
      toast.success(t("article.deleted"));
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
      navigate({ to: "/articles" });
    },
    onError: () => toast.error(t("article.deleteFailed")),
  });

  const enqueueInlineUploads = (files: File[], position: number) => {
    const images = extractImageFiles(files);
    if (images.length === 0) return;
    setIsUploadingImages(true);
    void uploadAndInsertImages({
      editorRef,
      files: images,
      onError: () => toast.error(t("article.imageUploadFailed")),
      position,
      upload: (file) => uploadAttachment({ file, article: articleId }),
    }).finally(() => setIsUploadingImages(false));
  };

  // Loading and error share the loaded editor's container so the page does
  // not jump sideways once the article arrives.
  const containerClass =
    "mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-3 px-4 pb-16";

  if (articleQuery.isLoading) {
    return (
      <div className={containerClass}>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-[50vh] w-full" />
      </div>
    );
  }

  if (articleQuery.isError || !article) {
    return (
      <div className={containerClass}>
        <header className="flex items-center gap-2">
          <Button
            onClick={() => navigate({ to: "/articles" })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" data-icon="inline-start" />
            {t("common.back")}
          </Button>
        </header>
        <QueryErrorState
          isRetrying={articleQuery.isFetching}
          onRetry={() => void articleQuery.refetch()}
        />
      </div>
    );
  }

  const isPublished = article.status === "published";
  const shownArticle = savedArticle ?? article;

  return (
    <div>
      {/* One quiet bar for state and actions, the page itself for writing:
          the title is the article's first line, not a form field. The bar
          stays pinned so save state and publish remain in reach on long
          articles. It spans the full width and carries the body's paper
          grain, so the pinned band reads as the same sheet, not a strip. */}
      <header className="sticky top-0 z-20 bg-background/90 bg-(image:--paper-grain) backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-1 px-4">
          <Button
            aria-label={t("common.back")}
            onClick={() => navigate({ to: "/articles" })}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <span
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            data-article-save-state={saveState}
          >
            {saveState === "saving"
              ? t("article.saving")
              : saveState === "dirty"
                ? t("article.unsaved")
                : t("article.saved")}
            <span className="hidden sm:inline">
              {" · "}
              {t("article.wordCount", { count: countArticleChars(content) })}
            </span>
          </span>
          {isPublished && (
            <Button
              aria-label={t("article.viewPublic")}
              onClick={() =>
                window.open(`/article/${shownArticle.slug}`, "_blank")
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <ExternalLinkIcon data-icon="inline-start" />
              <span className="hidden sm:inline">
                {t("article.viewPublic")}
              </span>
            </Button>
          )}
          <Button
            aria-label={
              previewMode ? t("article.editMode") : t("article.previewAction")
            }
            onClick={() => setPreviewMode((mode) => !mode)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {previewMode ? (
              <PencilIcon data-icon="inline-start" />
            ) : (
              <EyeIcon data-icon="inline-start" />
            )}
            <span className="hidden sm:inline">
              {previewMode ? t("article.editMode") : t("article.previewAction")}
            </span>
          </Button>
          <Button
            disabled={isUploadingImages}
            onClick={() => setPublishOpen(true)}
            size="sm"
            type="button"
            variant={isPublished ? "outline" : "default"}
          >
            {isUploadingImages && <Spinner data-icon="inline-start" />}
            {isPublished
              ? t("article.publishedBadge")
              : t("article.publishAction")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("common.more")}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={deleteMutation.isPending}
                variant="destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2Icon />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className={`${containerClass} pt-3`}>
        <textarea
          aria-label={t("article.titleLabel")}
          className={cn(
            "field-sizing-content mt-2 w-full resize-none bg-transparent leading-tight font-semibold tracking-tight outline-none placeholder:text-foreground/30",
            // Preview sets the title the way the public page does: same
            // serif, size and measure as the body below it.
            previewMode
              ? "article-paper mb-[0.6em] text-[1.85rem] leading-[1.3] tracking-[-0.01em]"
              : "font-heading text-3xl",
          )}
          rows={1}
          readOnly={previewMode}
          onChange={(event) => {
            // The refs — not React state — are what the debounced save reads
            // (state is stale inside the timer closure), so both must update
            // on every keystroke. A title is one line: newlines are dropped.
            const value = event.target.value.replace(/\n/g, " ");
            titleRef.current = value;
            setTitle(value);
            scheduleSave();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              editorRef.current?.commands.focus("start");
            }
          }}
          placeholder={t("article.titlePlaceholder")}
          value={title}
        />

        {previewMode ? (
          // The title line above already reads as the article's heading; the
          // preview renders only the body, aligned with the editing surface.
          <div className="article-paper min-h-svh pt-2 pb-16">
            <ArticleShikiBody content={content} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ArticleToolbar active={activeTools} editorRef={editorRef} />
            <ArticleEditor
              content={content}
              disabled={false}
              editorRef={editorRef}
              onContentChange={(next) => {
                contentRef.current = next;
                setContent(next);
                scheduleSave();
              }}
              onImageFiles={enqueueInlineUploads}
              onTransaction={syncActiveTools}
              placeholder={t("article.contentPlaceholder")}
            />
          </div>
        )}

        <ArticlePublishDialog
          article={shownArticle}
          onOpenChange={setPublishOpen}
          onPublished={(updated) => {
            setSavedArticle(updated);
            void queryClient.invalidateQueries({ queryKey: ["articles"] });
          }}
          onUnpublished={(updated) => {
            setSavedArticle(updated);
            void queryClient.invalidateQueries({ queryKey: ["articles"] });
          }}
          open={publishOpen}
        />
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("article.deleteConfirm")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("article.deleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                variant="destructive"
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/** Marks and blocks the toolbar lights up when the caret sits inside them. */
const ARTICLE_TOOL_STATES = [
  "h2",
  "h3",
  "bold",
  "italic",
  "strike",
  "code",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
] as const;
type ArticleToolState = (typeof ARTICLE_TOOL_STATES)[number];
type ArticleActiveTools = Record<ArticleToolState, boolean>;

function readArticleActiveTools(editor: Editor): ArticleActiveTools {
  return {
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
  };
}

function ArticleToolbar({
  editorRef,
  active,
}: {
  editorRef: React.RefObject<Editor | null>;
  active: Partial<ArticleActiveTools>;
}) {
  const { t } = useI18n();
  const run = (action: (editor: Editor) => void) => () => {
    const editor = editorRef.current;
    if (editor) action(editor);
  };
  const tools: {
    icon: React.ReactNode;
    label: string;
    state?: ArticleToolState;
    run: () => void;
  }[] = [
    {
      icon: <Heading2Icon className="size-4" />,
      label: t("article.toolH2"),
      state: "h2" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
      }),
    },
    {
      icon: <Heading3Icon className="size-4" />,
      label: t("article.toolH3"),
      state: "h3" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
      }),
    },
    {
      icon: <BoldIcon className="size-4" />,
      label: t("article.toolBold"),
      state: "bold" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleBold().run();
      }),
    },
    {
      icon: <ItalicIcon className="size-4" />,
      label: t("article.toolItalic"),
      state: "italic" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleItalic().run();
      }),
    },
    {
      icon: <StrikethroughIcon className="size-4" />,
      label: t("article.toolStrike"),
      state: "strike" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleStrike().run();
      }),
    },
    {
      icon: <CodeIcon className="size-4" />,
      label: t("article.toolCode"),
      state: "code" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleCode().run();
      }),
    },
    {
      icon: <ListIcon className="size-4" />,
      label: t("article.toolBulletList"),
      state: "bulletList" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleBulletList().run();
      }),
    },
    {
      icon: <ListOrderedIcon className="size-4" />,
      label: t("article.toolOrderedList"),
      state: "orderedList" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleOrderedList().run();
      }),
    },
    {
      icon: <ListTodoIcon className="size-4" />,
      label: t("article.toolTaskList"),
      state: "taskList" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleTaskList().run();
      }),
    },
    {
      icon: <QuoteIcon className="size-4" />,
      label: t("article.toolQuote"),
      state: "blockquote" as ArticleToolState,
      run: run((editor) => {
        editor.chain().focus().toggleBlockquote().run();
      }),
    },
    {
      icon: <MinusIcon className="size-4" />,
      label: t("article.toolRule"),
      run: run((editor) => {
        editor.chain().focus().setHorizontalRule().run();
      }),
    },
    {
      icon: <TableIcon className="size-4" />,
      label: t("article.toolTable"),
      run: run((editor) => {
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      }),
    },
  ];
  // Grouped as headings · inline marks · lists · blocks; thin rules between
  // groups keep twelve identical icon buttons scannable.
  const groupEnds = new Set([
    t("article.toolH3"),
    t("article.toolCode"),
    t("article.toolTaskList"),
  ]);
  return (
    // Pinned under the header so formatting stays a glance away on long
    // articles; one scrollable line instead of wrapping into two on phones.
    <div className="no-scrollbar sticky top-14 z-10 flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border/60 bg-background/90 p-1 backdrop-blur-sm">
      {tools.map((tool) => (
        <Fragment key={tool.label}>
          <Button
            aria-label={tool.label}
            aria-pressed={tool.state ? Boolean(active[tool.state]) : undefined}
            className="shrink-0 aria-pressed:bg-muted aria-pressed:text-foreground"
            // Keep the editor's selection: a toolbar click must not blur it
            // first, or the pressed state flickers off before the toggle.
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.run}
            size="icon"
            title={tool.label}
            type="button"
            variant="ghost"
          >
            {tool.icon}
          </Button>
          {groupEnds.has(tool.label) && (
            <span
              aria-hidden="true"
              className="mx-1 h-5 w-px shrink-0 bg-border"
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
