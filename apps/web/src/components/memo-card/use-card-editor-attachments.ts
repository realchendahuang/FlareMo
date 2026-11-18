import type { Editor } from "@tiptap/react";
import { type RefObject, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Attachment, uploadAttachment } from "@/api";
import {
  filterAcceptedComposerFiles,
  isImageContentType,
  isImageFile,
} from "@/components/composer/attachment-upload-helpers";
import { useI18n } from "@/i18n";
import {
  extractReferencedAttachmentIds,
  filterUnreferencedAttachments,
} from "@/lib/attachment-refs";
import { errorMessage } from "@/lib/error";
import { uploadAndInsertImages } from "@/lib/rich-editor-upload";

export type UploadingAttachmentEntry = {
  key: string;
  file: File;
};

type InlineUploadedItem = {
  id: string;
  attachment: Attachment;
};

let nextUploadEntryId = 0;

function stripAttachmentPrefix(name: string): string {
  return name.replace(/^attachments\//, "");
}

export type UseCardEditorAttachmentsOptions = {
  /** Attachments bound to the memo when editing started. */
  initialAttachments: Attachment[];
  /** Markdown content when editing started, used to tell inline vs gallery files. */
  initialContent: string;
  /** Live markdown inside the card editor. */
  draftContent: string;
  editorRef: RefObject<Editor | null>;
};

/**
 * Owns the full attachment lifecycle of `MemoCardEditor`:
 * - Tracks existing gallery attachments and lets the author remove them in-place
 *   without mutating the persisted memo if the edit is cancelled.
 * - Uploads newly picked, pasted or dropped files unbound (`uploadAttachment({ file })`)
 *   with live uploading chips, error toasts and pre-save removal.
 * - Chains pasted/dropped inline editor images unbound so cancelling leaves the
 *   original memo untouched.
 * - Computes the merged attachment resource-name list on save.
 */
export function useCardEditorAttachments({
  initialAttachments,
  initialContent,
  draftContent,
  editorRef,
}: UseCardEditorAttachmentsOptions) {
  const { t } = useI18n();
  const [baselineAttachments] = useState(() => initialAttachments);
  const [initialInlineIds] = useState(() =>
    extractReferencedAttachmentIds(initialContent),
  );
  const [removedExistingNames, setRemovedExistingNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [uploadingEntries, setUploadingEntries] = useState<
    UploadingAttachmentEntry[]
  >([]);
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>(
    [],
  );
  const [inlineUploadingCount, setInlineUploadingCount] = useState(0);
  const [inlineUploaded, setInlineUploaded] = useState<InlineUploadedItem[]>(
    [],
  );

  // Cancellation guard for unmounted sessions or removed in-flight chips.
  const cancelledUploadKeysRef = useRef<Set<string>>(new Set());
  const inlineChainRef = useRef<Promise<void>>(Promise.resolve());

  const referencedNow = useMemo(
    () => extractReferencedAttachmentIds(draftContent),
    [draftContent],
  );

  const retainedExistingAttachments = useMemo(
    () =>
      baselineAttachments.filter((attachment) => {
        if (removedExistingNames.has(attachment.name)) return false;
        const bareId = attachment.id || stripAttachmentPrefix(attachment.name);
        if (initialInlineIds.has(bareId)) {
          return referencedNow.has(bareId);
        }
        return true;
      }),
    [
      baselineAttachments,
      initialInlineIds,
      referencedNow,
      removedExistingNames,
    ],
  );

  const visibleExistingAttachments = useMemo(
    () =>
      filterUnreferencedAttachments(retainedExistingAttachments, draftContent),
    [retainedExistingAttachments, draftContent],
  );

  const activeInlineUploaded = useMemo(
    () => inlineUploaded.filter((item) => referencedNow.has(item.id)),
    [inlineUploaded, referencedNow],
  );

  // Live counts read through a ref so rapid consecutive pastes/picks never
  // read stale render-time numbers.
  const countsRef = useRef({ existingFileCount: 0, existingImageCount: 0 });
  countsRef.current = {
    existingFileCount:
      retainedExistingAttachments.length +
      activeInlineUploaded.length +
      uploadedAttachments.length +
      uploadingEntries.length +
      inlineUploadingCount,
    existingImageCount:
      retainedExistingAttachments.filter((item) =>
        isImageContentType(item.content_type),
      ).length +
      activeInlineUploaded.length +
      uploadedAttachments.filter((item) =>
        isImageContentType(item.content_type),
      ).length +
      uploadingEntries.filter((entry) => isImageFile(entry.file)).length +
      inlineUploadingCount,
  };

  const enqueueFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { accepted, errorKeys } = filterAcceptedComposerFiles({
      incoming,
      existingFileCount: countsRef.current.existingFileCount,
      existingImageCount: countsRef.current.existingImageCount,
    });
    for (const key of errorKeys) toast.error(t(key));
    if (accepted.length === 0) return;

    const entries: UploadingAttachmentEntry[] = accepted.map((file) => {
      nextUploadEntryId += 1;
      return { key: `card-upload-${nextUploadEntryId}`, file };
    });
    // Advance ref immediately so a synchronous second call sees the new slots.
    countsRef.current.existingFileCount += entries.length;
    countsRef.current.existingImageCount += entries.filter((entry) =>
      isImageFile(entry.file),
    ).length;

    setUploadingEntries((prev) => [...prev, ...entries]);

    for (const entry of entries) {
      void uploadAttachment({ file: entry.file })
        .then((attachment) => {
          if (cancelledUploadKeysRef.current.has(entry.key)) return;
          setUploadedAttachments((prev) => [...prev, attachment]);
        })
        .catch((error) => {
          if (cancelledUploadKeysRef.current.has(entry.key)) return;
          toast.error(errorMessage(error, t("toast.requestFailed")));
        })
        .finally(() => {
          setUploadingEntries((prev) =>
            prev.filter((item) => item.key !== entry.key),
          );
        });
    }
  };

  const enqueueInlineImages = (incoming: File[], position: number) => {
    if (incoming.length === 0) return;
    const { accepted, errorKeys } = filterAcceptedComposerFiles({
      incoming,
      existingFileCount: countsRef.current.existingFileCount,
      existingImageCount: countsRef.current.existingImageCount,
    });
    for (const key of errorKeys) toast.error(t(key));
    if (accepted.length === 0) return;

    countsRef.current.existingFileCount += accepted.length;
    countsRef.current.existingImageCount += accepted.length;
    setInlineUploadingCount((count) => count + accepted.length);

    inlineChainRef.current = inlineChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await uploadAndInsertImages({
            editorRef,
            files: accepted,
            position,
            upload: (file) => uploadAttachment({ file }),
            onUploaded: (attachment) => {
              const fullAttachment = attachment as Attachment;
              const bareId =
                fullAttachment.id || stripAttachmentPrefix(fullAttachment.name);
              setInlineUploaded((prev) => [
                ...prev,
                { id: bareId, attachment: fullAttachment },
              ]);
            },
            onError: () => toast.error(t("composer.imageUploadFailed")),
          });
        } finally {
          setInlineUploadingCount((count) =>
            Math.max(0, count - accepted.length),
          );
        }
      });
  };

  const removeExistingAttachment = (name: string) => {
    setRemovedExistingNames((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const removeUploadedAttachment = (name: string) => {
    setUploadedAttachments((prev) => prev.filter((item) => item.name !== name));
  };

  const cancelUploadingEntry = (key: string) => {
    cancelledUploadKeysRef.current.add(key);
    setUploadingEntries((prev) => prev.filter((item) => item.key !== key));
  };

  const resolveAttachmentSubmission = (finalContent: string) => {
    const referencedFinal = extractReferencedAttachmentIds(finalContent);
    const seen = new Set<string>();
    const names: string[] = [];
    const attachments: Attachment[] = [];

    const pushAttachment = (attachment: Attachment) => {
      if (seen.has(attachment.name)) return;
      seen.add(attachment.name);
      names.push(attachment.name);
      attachments.push(attachment);
    };

    for (const attachment of baselineAttachments) {
      if (removedExistingNames.has(attachment.name)) continue;
      const bareId = attachment.id || stripAttachmentPrefix(attachment.name);
      if (initialInlineIds.has(bareId) && !referencedFinal.has(bareId)) {
        continue;
      }
      pushAttachment(attachment);
    }

    for (const item of inlineUploaded) {
      if (referencedFinal.has(item.id)) {
        pushAttachment(item.attachment);
      }
    }

    for (const attachment of uploadedAttachments) {
      pushAttachment(attachment);
    }

    const baselineNames = baselineAttachments.map((item) => item.name);
    const changed =
      baselineNames.length !== names.length ||
      baselineNames.some((name, index) => name !== names[index]);

    return { names, attachments, changed };
  };

  const isUploading = uploadingEntries.length > 0 || inlineUploadingCount > 0;
  const hasAnyAttachments =
    retainedExistingAttachments.length > 0 ||
    activeInlineUploaded.length > 0 ||
    uploadedAttachments.length > 0;
  const hasAttachmentEdits =
    removedExistingNames.size > 0 ||
    uploadedAttachments.length > 0 ||
    activeInlineUploaded.length > 0 ||
    isUploading ||
    retainedExistingAttachments.length !== baselineAttachments.length;

  return {
    visibleExistingAttachments,
    uploadedAttachments,
    uploadingEntries,
    isUploading,
    hasAnyAttachments,
    hasAttachmentEdits,
    enqueueFiles,
    enqueueInlineImages,
    removeExistingAttachment,
    removeUploadedAttachment,
    cancelUploadingEntry,
    resolveAttachmentSubmission,
  };
}
