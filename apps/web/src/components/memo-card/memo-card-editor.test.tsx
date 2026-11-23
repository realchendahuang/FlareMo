// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Memo } from "@/api";
import { MemoCard } from "@/components/memo-card";
import type { RichComposerEditorProps } from "@/components/rich-composer-editor";

const {
  uploadAttachmentMock,
  bindMemoAttachmentsMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  uploadAttachmentMock: vi.fn(),
  bindMemoAttachmentsMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string, params?: Record<string, unknown>) =>
      params?.filename ? `${key}:${String(params.filename)}` : key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => (
    <a className={className} href="/">
      {children}
    </a>
  ),
}));

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api")>();
  return {
    ...actual,
    uploadAttachment: uploadAttachmentMock,
    bindMemoAttachments: bindMemoAttachmentsMock,
    listTasksForSourceMemos: vi.fn().mockResolvedValue({ tasks: [] }),
  };
});

// Synchronous lightweight rich-editor double that exercises the exact callback
// contract (`onContentChange`, `onImageFiles`, `onEscape`, `onSubmitRequest`).
vi.mock("@/components/rich-composer-editor-lazy", () => ({
  RichComposerEditor: ({
    ariaLabel,
    content,
    disabled,
    inputId,
    contentClassName,
    onContentChange,
    onImageFiles,
    onEscape,
    onSubmitRequest,
  }: RichComposerEditorProps) => (
    <textarea
      aria-label={ariaLabel}
      className={contentClassName}
      disabled={disabled}
      id={inputId}
      value={content}
      onChange={(event) => onContentChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onEscape?.();
        } else if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey
        ) {
          event.preventDefault();
          onSubmitRequest();
        }
      }}
      onPaste={(event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (images.length > 0) {
          event.preventDefault();
          onImageFiles(images, content.length);
        }
      }}
    />
  ),
}));

vi.mock("@/lib/rich-editor-upload", () => ({
  uploadAndInsertImages: async ({
    files,
    upload,
    onUploaded,
    onError,
  }: {
    files: File[];
    upload: (file: File) => Promise<Attachment>;
    onUploaded?: (attachment: Attachment, markdown: string) => void;
    onError: () => void;
  }) => {
    for (const file of files) {
      try {
        const attachment = await upload(file);
        const markdown = `![${attachment.filename}](/file/attachments/${attachment.id}/${encodeURIComponent(attachment.filename)})`;
        onUploaded?.(attachment, markdown);
      } catch {
        onError();
        return;
      }
    }
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeAttachment(
  id: string,
  filename: string,
  contentType = "image/png",
): Attachment {
  return {
    id,
    name: `attachments/${id}`,
    memo: "memos/memo-1",
    filename,
    content_type: contentType,
    size: 2048,
    state: "ready",
    etag: null,
    payload: {},
    create_time: "2026-11-01T00:00:00Z",
    update_time: "2026-11-01T00:00:00Z",
    download_url: `/api/v1/attachments/${id}/blob`,
    preview_url: `/file/attachments/${id}/${filename}`,
  };
}

function makeMemo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: "memo-1",
    name: "memos/memo-1",
    creator: "users/owner",
    content: "初始记录正文",
    visibility: "private",
    state: "normal",
    pinned: false,
    payload: {},
    create_time: "2026-11-01T00:00:00Z",
    update_time: "2026-11-01T00:00:00Z",
    display_time: "2026-11-01T00:00:00Z",
    attachments: [],
    can_manage: true,
    can_govern: true,
    ...overrides,
  };
}

const roots: Array<{
  root: ReturnType<typeof createRoot>;
  container: HTMLDivElement;
}> = [];

function mountWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
  });
  return { container, queryClient };
}

beforeEach(() => {
  uploadAttachmentMock.mockReset();
  bindMemoAttachmentsMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("MemoCardEditor attachment uploads and keyboard UX (Issue #162)", () => {
  it("uploads picked files, blocks save while uploading, and merges kept + new attachments on save", async () => {
    const existingKeep = makeAttachment(
      "att-keep",
      "keep.pdf",
      "application/pdf",
    );
    const existingDrop = makeAttachment(
      "att-drop",
      "drop.pdf",
      "application/pdf",
    );
    const newUploaded = makeAttachment("att-new", "fresh.png", "image/png");

    let resolveUpload!: (attachment: Attachment) => void;
    uploadAttachmentMock.mockImplementation(
      () =>
        new Promise<Attachment>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    bindMemoAttachmentsMock.mockResolvedValue({
      attachments: [existingKeep, newUploaded],
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    function Harness() {
      const [memo] = useState(() => makeMemo());
      return (
        <MemoCard
          attachments={[existingKeep, existingDrop]}
          canGovern
          canManage
          memo={memo}
          onArchive={vi.fn()}
          onHardDelete={vi.fn()}
          onPin={vi.fn()}
          onRestore={vi.fn()}
          onShare={vi.fn()}
          onTrash={vi.fn()}
          onUpdate={onUpdate}
        />
      );
    }

    const { container } = mountWithQueryClient(<Harness />);

    // Open the ⋯ menu and click Edit.
    const actionsBtn = container.querySelector(
      'button[aria-label="common.actions"]',
    ) as HTMLButtonElement;
    await act(async () => {
      actionsBtn.click();
    });
    const editItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((el) => el.textContent?.includes("common.edit")) as HTMLElement;
    await act(async () => {
      editItem.click();
    });

    const editorInput = container.querySelector(
      "#flaremo-card-editor-input",
    ) as HTMLTextAreaElement;
    expect(editorInput).toBeTruthy();
    // Multiline regression check (#9): card editor removes the 320px height clamp.
    expect(editorInput.className).toContain("max-h-none!");

    // Existing attachments are rendered in the tray; remove `drop.pdf`.
    const removeDropBtn = container.querySelector(
      'button[aria-label="composer.removeFile:drop.pdf"]',
    ) as HTMLButtonElement;
    expect(removeDropBtn).toBeTruthy();
    await act(async () => {
      removeDropBtn.click();
    });
    expect(
      container.querySelector(
        'button[aria-label="composer.removeFile:drop.pdf"]',
      ),
    ).toBeNull();

    // Pick a new file via the card editor's hidden file input.
    const fileInput = container.querySelector(
      '[data-testid="card-editor-file-input"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const pickedFile = new File(["img"], "fresh.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [pickedFile],
        configurable: true,
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // While upload is in flight, uploading chip shows and Save is disabled.
    expect(container.querySelector('[data-uploading="true"]')).toBeTruthy();
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent === "common.save",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Finish the upload; Save re-enables and the uploaded chip appears.
    await act(async () => {
      resolveUpload(newUploaded);
    });
    expect(container.querySelector('[data-uploading="true"]')).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="composer.removeFile:fresh.png"]',
      ),
    ).toBeTruthy();
    expect(saveBtn.disabled).toBe(false);

    // Save merges kept existing (`att-keep`) + newly uploaded (`att-new`).
    await act(async () => {
      saveBtn.click();
    });

    expect(bindMemoAttachmentsMock).toHaveBeenCalledTimes(1);
    expect(bindMemoAttachmentsMock).toHaveBeenCalledWith("memo-1", [
      "attachments/att-keep",
      "attachments/att-new",
    ]);
    expect(onUpdate).toHaveBeenCalledWith("memo-1", {
      content: "初始记录正文",
      visibility: "private",
    });
    // Editor closes once saved.
    expect(container.querySelector("#flaremo-card-editor-input")).toBeNull();
  });

  it("uploads dropped non-image files and surfaces upload errors without losing edits", async () => {
    uploadAttachmentMock.mockRejectedValueOnce(new Error("配额已满"));
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    function StandaloneEditorHarness() {
      const [content, setContent] = useState("草稿内容");
      return (
        <MemoCard
          attachments={[]}
          canGovern
          canManage
          memo={makeMemo({ content })}
          onArchive={vi.fn()}
          onHardDelete={vi.fn()}
          onPin={vi.fn()}
          onRestore={vi.fn()}
          onShare={vi.fn()}
          onTrash={vi.fn()}
          onUpdate={async (id, input) => {
            setContent(input.content);
            await onUpdate(id, input);
          }}
        />
      );
    }

    const { container } = mountWithQueryClient(<StandaloneEditorHarness />);

    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="common.actions"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
          el.textContent?.includes("common.edit"),
        ) as HTMLElement
      ).click();
    });

    const editorRoot = container.querySelector("#flaremo-card-editor-input")
      ?.parentElement as HTMLElement;
    expect(editorRoot).toBeTruthy();

    // Drag enter highlights the card editor drop zone.
    await act(async () => {
      const enterEvent = new Event("dragenter", { bubbles: true });
      Object.defineProperty(enterEvent, "dataTransfer", {
        value: { types: ["Files"] },
      });
      editorRoot.dispatchEvent(enterEvent);
    });
    expect(editorRoot.getAttribute("data-dragging")).toBe("true");

    // Drop a PDF file; upload fails and reports the error via toast.
    const droppedPdf = new File(["pdf"], "broken.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, "dataTransfer", {
        value: { files: [droppedPdf], types: ["Files"] },
      });
      editorRoot.dispatchEvent(dropEvent);
    });

    expect(editorRoot.getAttribute("data-dragging")).toBeNull();
    expect(uploadAttachmentMock).toHaveBeenCalledWith({ file: droppedPdf });
    expect(toastErrorMock).toHaveBeenCalledWith("配额已满");
    expect(container.querySelector('[data-uploading="true"]')).toBeNull();
  });

  it("exits immediately on Escape when clean, guards unsaved edits on first Escape, and saves on Cmd+Enter", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = mountWithQueryClient(
      <MemoCard
        attachments={[]}
        canGovern
        canManage
        memo={makeMemo({ content: "原文" })}
        onArchive={vi.fn()}
        onHardDelete={vi.fn()}
        onPin={vi.fn()}
        onRestore={vi.fn()}
        onShare={vi.fn()}
        onTrash={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    const openEditor = async () => {
      await act(async () => {
        (
          container.querySelector(
            'button[aria-label="common.actions"]',
          ) as HTMLButtonElement
        ).click();
      });
      await act(async () => {
        (
          Array.from(document.querySelectorAll('[role="menuitem"]')).find(
            (el) => el.textContent?.includes("common.edit"),
          ) as HTMLElement
        ).click();
      });
    };

    // 1. Clean state: single Escape exits immediately.
    await openEditor();
    let textarea = container.querySelector(
      "#flaremo-card-editor-input",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("#flaremo-card-editor-input")).toBeNull();

    // 2. Dirty state: first Escape shows unsaved guard without losing text;
    //    typing clears the guard; two Escapes discard; Cmd+Enter saves.
    await openEditor();
    textarea = container.querySelector(
      "#flaremo-card-editor-input",
    ) as HTMLTextAreaElement;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "原文已修改");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    // Still open with unsaved guard visible!
    expect(container.querySelector("#flaremo-card-editor-input")).toBeTruthy();
    expect(
      container.querySelector('[data-testid="card-editor-unsaved-guard"]'),
    ).toBeTruthy();

    // Typing again clears the discard confirmation guard.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "原文已修改并继续输入");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="card-editor-unsaved-guard"]'),
    ).toBeNull();

    // Cmd+Enter saves the edit cleanly.
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onUpdate).toHaveBeenCalledWith("memo-1", {
      content: "原文已修改并继续输入",
      visibility: "private",
    });
    expect(container.querySelector("#flaremo-card-editor-input")).toBeNull();
  });
});
