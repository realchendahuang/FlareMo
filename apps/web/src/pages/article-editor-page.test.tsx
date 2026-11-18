// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/api";

const getArticleMock = vi.fn();
const updateArticleMock = vi.fn();
const deleteArticleMock = vi.fn();
const uploadAttachmentMock = vi.fn();

vi.mock("@/api", () => ({
  getArticle: (...args: unknown[]) => getArticleMock(...args),
  updateArticle: (...args: unknown[]) => updateArticleMock(...args),
  deleteArticle: (...args: unknown[]) => deleteArticleMock(...args),
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/article-editor", () => ({
  ArticleEditor: ({
    content,
    onContentChange,
    placeholder,
  }: {
    content: string;
    onContentChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="mock-article-body"
      placeholder={placeholder}
      value={content}
      onChange={(event) => onContentChange(event.target.value)}
    />
  ),
  extractImageFiles: () => [],
}));

vi.mock("@/components/article-publish-dialog", () => ({
  ArticlePublishDialog: ({
    article,
    open,
  }: {
    article: Article;
    open: boolean;
  }) =>
    open ? (
      <div
        data-article-content={article.content}
        data-article-title={article.title}
        data-testid="mock-publish-dialog"
      />
    ) : null,
}));

vi.mock("@/components/article-shiki-body", () => ({
  ArticleShikiBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { queryKeys } from "@/lib/query-keys";
import { ArticleEditorPage } from "./article-editor-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeDraftArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "art-1",
    user_id: "user-1",
    slug: "",
    title: "",
    description: null,
    cover_attachment_id: null,
    lang: null,
    content: "",
    status: "draft",
    published_at: null,
    deleted_at: null,
    created_at: "2026-11-18T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
    ...overrides,
  };
}

const roots: Array<{
  container: HTMLDivElement;
  queryClient: QueryClient;
  root: ReturnType<typeof createRoot>;
}> = [];

function renderEditorPage(article: Article, articleId = "art-1") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(queryKeys.articles.detail(articleId), { article });
  const root = createRoot(container);
  roots.push({ container, queryClient, root });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ArticleEditorPage articleId={articleId} />
      </QueryClientProvider>,
    );
  });
  return { container, queryClient };
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function setNativeTextareaValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const { container, queryClient, root } of roots.splice(0)) {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

describe("ArticleEditorPage publish & save synchronisation", () => {
  it("flushes unsaved edits and waits for PATCH before opening ArticlePublishDialog", async () => {
    const initial = makeDraftArticle();
    getArticleMock.mockResolvedValue({ article: initial });

    let resolvePatch!: (value: { article: Article }) => void;
    updateArticleMock.mockImplementation(
      () =>
        new Promise<{ article: Article }>((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { container } = renderEditorPage(initial);

    const publishButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("article.publishAction"),
    );
    expect(publishButton).toBeTruthy();
    // Fresh empty draft keeps Publish disabled
    expect(publishButton?.disabled).toBe(true);

    const titleInput = container.querySelector(
      'textarea[aria-label="article.titleLabel"]',
    ) as HTMLTextAreaElement;
    const bodyInput = container.querySelector(
      'textarea[aria-label="mock-article-body"]',
    ) as HTMLTextAreaElement;

    act(() => {
      setNativeTextareaValue(titleInput, "Ember 3 长文标题");
      setNativeTextareaValue(bodyInput, "正文尚未经过 2 秒自动保存窗口");
    });

    expect(publishButton?.disabled).toBe(false);
    // Still inside the 2s debounce window: no PATCH sent yet
    expect(updateArticleMock).not.toHaveBeenCalled();

    // Click Publish immediately before the 2s autosave timer fires
    await act(async () => {
      publishButton?.click();
      await flushMicrotasks();
    });

    expect(updateArticleMock).toHaveBeenCalledTimes(1);
    expect(updateArticleMock).toHaveBeenCalledWith("art-1", {
      title: "Ember 3 长文标题",
      content: "正文尚未经过 2 秒自动保存窗口",
    });
    // Dialog MUST stay closed until the PATCH finishes!
    expect(
      container.querySelector('[data-testid="mock-publish-dialog"]'),
    ).toBeNull();

    await act(async () => {
      resolvePatch({
        article: makeDraftArticle({
          title: "Ember 3 长文标题",
          content: "正文尚未经过 2 秒自动保存窗口",
        }),
      });
      await flushMicrotasks();
    });

    const dialog = container.querySelector(
      '[data-testid="mock-publish-dialog"]',
    );
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("data-article-title")).toBe("Ember 3 长文标题");
  });

  it("aborts opening ArticlePublishDialog when the pre-publish PATCH fails", async () => {
    const initial = makeDraftArticle();
    getArticleMock.mockResolvedValue({ article: initial });
    updateArticleMock.mockRejectedValue(new Error("network down"));

    const { container } = renderEditorPage(initial);

    const titleInput = container.querySelector(
      'textarea[aria-label="article.titleLabel"]',
    ) as HTMLTextAreaElement;
    act(() => {
      setNativeTextareaValue(titleInput, "未落盘标题");
    });

    const publishButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("article.publishAction"),
    );

    await act(async () => {
      publishButton?.click();
      await flushMicrotasks();
    });

    expect(updateArticleMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="mock-publish-dialog"]'),
    ).toBeNull();
  });

  it("flushes pending edits immediately on Mod+S", async () => {
    const initial = makeDraftArticle();
    getArticleMock.mockResolvedValue({ article: initial });
    updateArticleMock.mockResolvedValue({
      article: makeDraftArticle({ title: "快捷键保存" }),
    });

    const { container } = renderEditorPage(initial);

    const titleInput = container.querySelector(
      'textarea[aria-label="article.titleLabel"]',
    ) as HTMLTextAreaElement;
    act(() => {
      setNativeTextareaValue(titleInput, "快捷键保存");
    });
    expect(updateArticleMock).not.toHaveBeenCalled();

    const saveEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "s",
      metaKey: true,
    });
    await act(async () => {
      window.dispatchEvent(saveEvent);
      await flushMicrotasks();
    });

    expect(saveEvent.defaultPrevented).toBe(true);
    expect(updateArticleMock).toHaveBeenCalledTimes(1);
    expect(updateArticleMock).toHaveBeenCalledWith("art-1", {
      title: "快捷键保存",
      content: "",
    });
  });
});
