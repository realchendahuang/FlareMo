// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotlightSearchTrigger } from "@/components/spotlight-search";
import { PushPanel } from "@/pages/account/push-panel";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

vi.mock("@/api", () => ({
  getPushConfig: vi.fn(),
  listMemos: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(resolve(here, "../../index.css"), "utf8");

const roots: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

afterEach(() => {
  for (const { container, root } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("Ember 3 scrollbar & dark-mode surface contract (Issue #162)", () => {
  it("declares light and dark color-scheme so native scrollbars never flash white in dark mode", () => {
    expect(indexCss).toMatch(/:root\s*\{[\s\S]*?color-scheme:\s*light;/);
    expect(indexCss).toMatch(/\.dark\s*\{[\s\S]*?color-scheme:\s*dark;/);
  });

  it("keeps body free of scrollbar-color so Chromium ::-webkit-scrollbar stays active", () => {
    const bodyMatch = indexCss.match(/\bbody\s*\{([^}]*)\}/);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch?.[1]).not.toContain("scrollbar-color");
    expect(bodyMatch?.[1]).not.toContain("scrollbar-width");
    // Standard scrollbar-width/color is gated strictly to non-webkit engines (Firefox)
    expect(indexCss).toContain("@supports not selector(::-webkit-scrollbar)");
    // Thin 6px warm-paper filament scrollbar rules are present
    expect(indexCss).toMatch(
      /::-webkit-scrollbar\s*\{[\s\S]*?width:\s*6px;[\s\S]*?height:\s*6px;/,
    );
  });
});

describe("PushPanel & SpotlightSearchTrigger accessibility", () => {
  it("renders an explanatory disabled row instead of an empty pane when Web Push is unsupported", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRoot(container);
    roots.push({ container, root });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PushPanel />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("push.title");
    expect(container.textContent).toContain("push.unsupported");
    const toggle = container.querySelector('[role="switch"]');
    expect(
      toggle?.getAttribute("aria-disabled") ?? toggle?.hasAttribute("disabled"),
    ).toBeTruthy();
  });

  it("exposes an accessible clear button on SpotlightSearchTrigger without triggering open", () => {
    const onOpen = vi.fn();
    const onClear = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ container, root });

    act(() => {
      root.render(
        <SpotlightSearchTrigger
          activeQuery="#ember"
          onClear={onClear}
          onClick={onOpen}
        />,
      );
    });

    const clearBtn = container.querySelector(
      'button[aria-label="search.clear"]',
    ) as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();

    act(() => {
      clearBtn?.click();
    });

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
