import type { Editor } from "@tiptap/react";

/**
 * Move the caret to the end one frame after the editor is asked to focus.
 *
 * Focusing synchronously from the mount effect races TipTap's own mount work:
 * `Editor.mount` schedules its `create` event on a timer, and the focus command
 * dispatches a transaction built from a state snapshot. On touch layouts with
 * long markdown the initial content application can replace `view.state.doc`
 * before that transaction lands, and ProseMirror rejects it with
 * `RangeError: Applying a mismatched transaction` (issue #155). Deferring to the
 * next frame lets the mount settle; the guards keep the deferred call safe when
 * the editor was destroyed or the document was swapped in the meantime.
 *
 * Returns a cleanup that cancels the pending frame.
 */
export function focusEditorOnNextFrame(editor: Editor | null): () => void {
  if (!editor) return () => {};
  const frame = requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    try {
      editor.commands.focus("end");
    } catch {
      // The document was replaced while we were waiting for the frame. Skip
      // the auto-focus instead of surfacing a mount-time crash; the next user
      // interaction focuses the editor through the normal path.
    }
  });
  return () => cancelAnimationFrame(frame);
}
