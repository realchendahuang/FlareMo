import { useQuery } from "@tanstack/react-query";
import { getPublicShare } from "@/api";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { MemoReadingView } from "@/components/reading/memo-reading-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";

export function PublicSharePage({ token }: { token: string }) {
  const { locale, t } = useI18n();
  const shareQuery = useQuery({
    queryKey: ["public-share", token],
    queryFn: () => getPublicShare(token),
    retry: false,
  });

  return (
    <div className="min-h-svh bg-background px-4 py-6 sm:py-10">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="border-b pb-4">
          <FlareMoLogo labelClassName="text-lg" markClassName="size-7" />
        </header>
        {shareQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}
        {shareQuery.isError && (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyTitle>{t("share.unavailable")}</EmptyTitle>
              <EmptyDescription>
                {t("share.unavailableDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {shareQuery.data && (
          // overflow-clip keeps the rounded clipping but, unlike the Card
          // base's overflow-hidden, does not turn the card into a scroll
          // container — the sticky reading transport needs the viewport as
          // its scrollport.
          <Card className="overflow-clip">
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">
                {formatMemoTime(shareQuery.data.memo.display_time, locale)}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <MemoReadingView
                attachments={shareQuery.data.attachments}
                content={shareQuery.data.memo.content}
                contentClassName="text-base"
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
