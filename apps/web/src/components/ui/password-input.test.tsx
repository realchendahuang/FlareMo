// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
});

describe("PasswordInput", () => {
  it("keeps physical padding out of the RTL-sensitive edge", () => {
    const html = renderToStaticMarkup(<PasswordInput />);

    expect(html).toContain("pe-9");
    expect(html).not.toContain("pr-9");
  });

  it("keeps the toggle keyboard reachable and updates its pressed/label state", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(<PasswordInput />);
    });

    const toggle = container.querySelector("button");
    expect(toggle).toBeTruthy();
    expect(toggle?.tabIndex).toBe(0);
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.getAttribute("aria-label")).toBe("auth.showPassword");

    act(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("auth.hidePassword");
    expect(container.querySelector("input")?.type).toBe("text");
  });
});
