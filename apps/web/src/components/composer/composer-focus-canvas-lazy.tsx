import { lazy } from "react";

/**
 * The fullscreen focus canvas is ~35KB and loads on intent: the toolbar warms
 * it on hover/focus, and the real import covers touch and keyboard users. No
 * idle warm-up: most sessions never open full screen, so the bytes should not
 * be fetched on their behalf.
 */
const focusCanvasLoader = () =>
  import("@/components/composer/composer-focus-canvas");

export function loadComposerFocusCanvas() {
  return focusCanvasLoader();
}

export const ComposerFocusCanvas = lazy(async () => {
  const module = await focusCanvasLoader();
  return { default: module.ComposerFocusCanvas };
});
