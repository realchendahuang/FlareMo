import { useState } from "react";
import { toast } from "sonner";
import type { Article } from "@/api";
import { publishArticle, unpublishArticle, updateArticle } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";

/**
 * The publish gate: description (SEO), optional custom slug, and the
 * confirm that publishing makes the article fully public and indexable.
 * Unpublishing flips the same dialog into a confirm-only surface.
 */
export function ArticlePublishDialog({
  article,
  open,
  onOpenChange,
  onPublished,
  onUnpublished,
}: {
  article: Article | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: (article: Article) => void;
  onUnpublished: (article: Article) => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);

  if (!article) return null;
  const isPublished = article.status === "published";

  const submit = async () => {
    if (!article || pending) return;
    setPending(true);
    try {
      if (isPublished) {
        const { article: updated } = await unpublishArticle(article.id);
        onUnpublished(updated);
        toast.success(t("article.unpublishSuccess"));
        onOpenChange(false);
        return;
      }
      if (description.trim()) {
        await updateArticle(article.id, { description: description.trim() });
      }
      const { article: updated } = await publishArticle(
        article.id,
        slug.trim() || undefined,
      );
      onPublished(updated);
      toast.success(t("article.publishSuccess"));
      onOpenChange(false);
    } catch {
      toast.error(t("article.publishFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isPublished
              ? t("article.unpublishTitle")
              : t("article.publishTitle")}
          </DialogTitle>
          <DialogDescription>
            {isPublished
              ? t("article.unpublishDescription")
              : t("article.publishDescription")}
          </DialogDescription>
        </DialogHeader>
        {!isPublished && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="article-publish-slug"
              >
                {t("article.slugLabel")}
              </label>
              <Input
                id="article-publish-slug"
                onChange={(event) => setSlug(event.target.value)}
                placeholder={t("article.slugPlaceholder")}
                value={slug}
              />
              <p className="text-xs text-muted-foreground">
                {t("article.slugHint")}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="article-publish-description"
              >
                {t("article.descriptionLabel")}
              </label>
              <Textarea
                id="article-publish-description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("article.descriptionPlaceholder")}
                rows={3}
                value={description}
              />
              <p className="text-xs text-muted-foreground">
                {t("article.descriptionHint")}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={submit}
            type="button"
            variant={isPublished ? "destructive" : "default"}
          >
            {pending && <Spinner className="size-4" />}
            {isPublished
              ? t("article.unpublishAction")
              : t("article.publishAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
