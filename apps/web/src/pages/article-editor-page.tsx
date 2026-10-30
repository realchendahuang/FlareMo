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
import { useCallback, useEffect, useRef, useState } from "react";
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
    <div className={containerClass}>
      {/* One quiet bar for state and actions, the page itself for writing:
          the title is the article's first line, not a form field. */}
      <header className="flex items-center gap-1 pt-3">
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
            <span className="hidden sm:inline">{t("article.viewPublic")}</span>
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
      </header>
      <textarea
        aria-label={t("article.titleLabel")}
        className="field-sizing-content mt-4 w-full resize-none bg-transparent font-heading text-3xl leading-tight font-semibold tracking-tight outline-none placeholder:text-foreground/30"
        rows={1}
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
        <div className="memo-markdown min-h-svh px-2 text-[15px] leading-7">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight">
            {title || t("article.titlePlaceholder")}
          </h1>
          <ArticleShikiBody content={content} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ArticleToolbar editorRef={editorRef} />
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
  );
}

function ArticleToolbar({
  editorRef,
}: {
  editorRef: React.RefObject<Editor | null>;
}) {
  const { t } = useI18n();
  const run = (action: (editor: Editor) => void) => () => {
    const editor = editorRef.current;
    if (editor) action(editor);
  };
  const tools = [
    {
      icon: <Heading2Icon className="size-4" />,
      label: t("article.toolH2"),
      run: run((editor) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
      }),
    },
    {
      icon: <Heading3Icon className="size-4" />,
      label: t("article.toolH3"),
      run: run((editor) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
      }),
    },
    {
      icon: <BoldIcon className="size-4" />,
      label: t("article.toolBold"),
      run: run((editor) => {
        editor.chain().focus().toggleBold().run();
      }),
    },
    {
      icon: <ItalicIcon className="size-4" />,
      label: t("article.toolItalic"),
      run: run((editor) => {
        editor.chain().focus().toggleItalic().run();
      }),
    },
    {
      icon: <StrikethroughIcon className="size-4" />,
      label: t("article.toolStrike"),
      run: run((editor) => {
        editor.chain().focus().toggleStrike().run();
      }),
    },
    {
      icon: <CodeIcon className="size-4" />,
      label: t("article.toolCode"),
      run: run((editor) => {
        editor.chain().focus().toggleCode().run();
      }),
    },
    {
      icon: <ListIcon className="size-4" />,
      label: t("article.toolBulletList"),
      run: run((editor) => {
        editor.chain().focus().toggleBulletList().run();
      }),
    },
    {
      icon: <ListOrderedIcon className="size-4" />,
      label: t("article.toolOrderedList"),
      run: run((editor) => {
        editor.chain().focus().toggleOrderedList().run();
      }),
    },
    {
      icon: <ListTodoIcon className="size-4" />,
      label: t("article.toolTaskList"),
      run: run((editor) => {
        editor.chain().focus().toggleTaskList().run();
      }),
    },
    {
      icon: <QuoteIcon className="size-4" />,
      label: t("article.toolQuote"),
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
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 p-1">
      {tools.map((tool) => (
        <Button
          aria-label={tool.label}
          key={tool.label}
          onClick={tool.run}
          size="icon"
          title={tool.label}
          type="button"
          variant="ghost"
        >
          {tool.icon}
        </Button>
      ))}
    </div>
  );
}
