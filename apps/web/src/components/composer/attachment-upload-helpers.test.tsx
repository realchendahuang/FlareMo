// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  extractNonImageFiles,
  filterAcceptedComposerFiles,
  hasFileTransfer,
} from "./attachment-upload-helpers";
import { ComposerToolbar } from "./composer-toolbar";
import { NO_ACTIVE_FORMATS } from "./format-actions";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

function makeFile(name: string, type: string, size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("attachment-upload-helpers", () => {
  it("caps total memo images at nine while still accepting non-image files", () => {
    const incoming = [
      makeFile("a.png", "image/png"),
      makeFile("b.png", "image/png"),
      makeFile("c.png", "image/png"),
      makeFile("spec.pdf", "application/pdf"),
    ];

    const result = filterAcceptedComposerFiles({
      incoming,
      existingFileCount: 7,
      existingImageCount: 7,
    });

    expect(result.accepted.map((file) => file.name)).toEqual([
      "a.png",
      "b.png",
      "spec.pdf",
    ]);
    expect(result.errorKeys).toEqual(["toast.tooManyMemoImages"]);
  });

  it("rejects non-compressible files exceeding 25 MiB immediately", () => {
    const hugePdf = makeFile("huge.pdf", "application/pdf", 26 * 1024 * 1024);
    const smallTxt = makeFile("note.txt", "text/plain", 512);

    const result = filterAcceptedComposerFiles({
      incoming: [hugePdf, smallTxt],
      existingFileCount: 0,
      existingImageCount: 0,
    });

    expect(result.accepted.map((file) => file.name)).toEqual(["note.txt"]);
    expect(result.errorKeys).toEqual(["toast.attachmentTooLarge"]);
  });

  it("enforces the 100-attachment ceiling", () => {
    const result = filterAcceptedComposerFiles({
      incoming: [
        makeFile("one.txt", "text/plain"),
        makeFile("two.txt", "text/plain"),
      ],
      existingFileCount: 99,
      existingImageCount: 0,
    });

    expect(result.accepted.map((file) => file.name)).toEqual(["one.txt"]);
    expect(result.errorKeys).toEqual(["toast.tooManyAttachments"]);
  });

  it("separates non-image files and detects OS file drag transfers", () => {
    const files = [
      makeFile("shot.webp", "image/webp"),
      makeFile("report.pdf", "application/pdf"),
    ];
    expect(extractNonImageFiles(files).map((file) => file.name)).toEqual([
      "report.pdf",
    ]);
    expect(hasFileTransfer({ types: ["Files", "text/plain"] })).toBe(true);
    expect(hasFileTransfer({ types: ["text/plain"] })).toBe(false);
    expect(hasFileTransfer(null)).toBe(false);
  });

  it("gives each ComposerToolbar instance a distinct file input id", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <div>
          <ComposerToolbar
            activeFormats={NO_ACTIVE_FORMATS}
            captureAvailable={false}
            isPending={false}
            onAddFiles={() => undefined}
            onScheduleChange={() => undefined}
            onStartVoice={() => undefined}
            voiceActive={false}
            withEditor={() => undefined}
          />
          <ComposerToolbar
            activeFormats={NO_ACTIVE_FORMATS}
            captureAvailable={false}
            isPending={false}
            onAddFiles={() => undefined}
            onScheduleChange={() => undefined}
            onStartVoice={() => undefined}
            voiceActive={false}
            withEditor={() => undefined}
          />
        </div>
      </QueryClientProvider>,
    );

    const ids = [...html.matchAll(/id="(flaremo-attachment-[^"]+)"/g)].map(
      (match) => match[1],
    );
    const fors = [...html.matchAll(/for="(flaremo-attachment-[^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(fors).toEqual(ids);
  });
});
