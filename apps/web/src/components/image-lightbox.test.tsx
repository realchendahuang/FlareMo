// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox, type LightboxImage } from "./image-lightbox";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGES: LightboxImage[] = [
  { src: "/file/attachments/1/one.png", filename: "one.png" },
  { src: "/file/attachments/2/two.png", filename: "two.png" },
  { src: "/file/attachments/3/three.png", filename: "three.png" },
];

const roots: Array<{
  root: ReturnType<typeof createRoot>;
  container: HTMLDivElement;
}> = [];

afterEach(() => {
  document.documentElement.dir = "ltr";
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ImageLightbox", () => {
  it("supports keyboard paging (LTR & RTL), +/-/0 zoom shortcuts, double-click zoom and backdrop close", async () => {
    const onClose = vi.fn();

    function Harness() {
      const [index, setIndex] = useState(0);
      return (
        <ImageLightbox
          images={IMAGES}
          index={index}
          onIndexChange={setIndex}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          open
        />
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });

    await act(async () => {
      root.render(<Harness />);
    });

    const popup = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(popup).toBeTruthy();
    expect(document.querySelector("[data-lightbox-counter]")?.textContent).toBe(
      "1 / 3",
    );

    // LTR ArrowRight advances to 2 / 3.
    await act(async () => {
      popup.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.querySelector("[data-lightbox-counter]")?.textContent).toBe(
      "2 / 3",
    );

    // In RTL, ArrowLeft advances forward to 3 / 3.
    document.documentElement.dir = "rtl";
    await act(async () => {
      popup.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(document.querySelector("[data-lightbox-counter]")?.textContent).toBe(
      "3 / 3",
    );
    document.documentElement.dir = "ltr";

    // Keyboard `+` zooms to 125%, `0` resets to 100%, double-click toggles 200%.
    await act(async () => {
      popup.dispatchEvent(
        new KeyboardEvent("keydown", { key: "+", bubbles: true }),
      );
    });
    expect(popup.textContent).toContain("125%");

    await act(async () => {
      popup.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", bubbles: true }),
      );
    });
    expect(popup.textContent).toContain("100%");

    const img = popup.querySelector("img") as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(popup.textContent).toContain("200%");

    await act(async () => {
      img.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(popup.textContent).toContain("100%");

    // Clicking the viewport backdrop around the image closes the viewer.
    const viewport = img.parentElement as HTMLElement;
    await act(async () => {
      viewport.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
