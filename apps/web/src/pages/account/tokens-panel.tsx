import type { UseQueryResult } from "@tanstack/react-query";
import {
  CheckIcon,
  ClipboardIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
} from "lucide-react";
import type { PersonalAccessToken } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey } from "@/i18n";

type TokensPanelProps = {
  copied: boolean;
  createTokenIsPending: boolean;
  createdToken: string | null;
  locale: string;
  revokingTokenId: string | undefined;
  setTokenExpiryDays: (value: string) => void;
  setTokenName: (value: string) => void;
  t: (key: TranslationKey) => string;
  tokenError: string | null;
  tokenExpiryDays: string;
  tokenName: string;
  tokensQuery: UseQueryResult<
    { personal_access_tokens: PersonalAccessToken[] },
    Error
  >;
  onCopyToken: () => Promise<void>;
  onCreateToken: () => Promise<void>;
  onRevokeToken: (id: string) => Promise<void>;
  onHideCreatedToken: () => void;
};

export function TokensPanel({
  copied,
  createTokenIsPending,
  createdToken,
  locale,
  revokingTokenId,
  setTokenExpiryDays,
  setTokenName,
  t,
  tokenError,
  tokenExpiryDays,
  tokenName,
  tokensQuery,
  onCopyToken,
  onCreateToken,
  onRevokeToken,
  onHideCreatedToken,
}: TokensPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.tokensTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {createdToken && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <KeyRoundIcon className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {t("auth.tokenShownOnce")}
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                  {t("auth.tokenShownOnceDescription")}
                </p>
              </div>
            </div>
            <code className="mt-3 block overflow-x-auto rounded-lg bg-background/80 px-3 py-2 text-xs text-foreground">
              {createdToken}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void onCopyToken()}>
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <ClipboardIcon data-icon="inline-start" />
                )}
                {copied ? t("auth.copied") : t("auth.copyToken")}
              </Button>
              <Button size="sm" variant="outline" onClick={onHideCreatedToken}>
                <EyeOffIcon data-icon="inline-start" />
                {t("auth.hideToken")}
              </Button>
            </div>
          </div>
        )}

        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreateToken();
          }}
        >
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="account-token-name"
          >
            {t("auth.tokenName")}
            <Input
              disabled={createTokenIsPending}
              id="account-token-name"
              maxLength={32}
              placeholder={t("auth.tokenNamePlaceholder")}
              required
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="account-token-expiry"
          >
            {t("auth.tokenExpiry")}
            <Input
              disabled={createTokenIsPending}
              id="account-token-expiry"
              inputMode="numeric"
              max={365}
              min={1}
              placeholder={t("auth.never")}
              type="number"
              value={tokenExpiryDays}
              onChange={(event) => setTokenExpiryDays(event.target.value)}
            />
          </label>
          <Button disabled={createTokenIsPending} type="submit">
            {createTokenIsPending
              ? t("auth.creatingToken")
              : t("auth.createToken")}
          </Button>
        </form>
        {tokenError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {tokenError}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          {tokensQuery.isLoading && <TokenListSkeleton />}
          {tokensQuery.isError && (
            <p className="text-sm text-destructive">
              {t("auth.tokensLoadFailed")}
            </p>
          )}
          {tokensQuery.data?.personal_access_tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("auth.noTokens")}
            </p>
          )}
          {tokensQuery.data?.personal_access_tokens.map((token) => (
            <PersonalAccessTokenRow
              key={token.id}
              locale={locale}
              pending={revokingTokenId === token.id}
              token={token}
              onRevoke={() => onRevokeToken(token.id)}
              t={t}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PersonalAccessTokenRow({
  locale,
  pending,
  t,
  token,
  onRevoke,
}: {
  locale: string;
  pending: boolean;
  t: (key: TranslationKey) => string;
  token: PersonalAccessToken;
  onRevoke: () => Promise<void>;
}) {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const expiry = token.expires_at
    ? dateFormatter.format(new Date(token.expires_at))
    : t("auth.never");
  const lastUsed = token.last_request
    ? dateFormatter.format(new Date(token.last_request))
    : t("auth.neverUsed");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">
            {token.name ?? t("auth.unnamedToken")}
          </p>
          <Badge variant={token.enabled ? "secondary" : "outline"}>
            {token.enabled ? t("auth.active") : t("auth.revoked")}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {token.prefix ?? "memos_pat_"}
          {token.start ? `${token.start}…` : ""} · {t("auth.expires")}: {expiry}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("auth.lastUsed")}: {lastUsed} · {t("auth.requestCount")}:{" "}
          {token.request_count}
        </p>
      </div>
      {token.enabled && (
        <Button
          disabled={pending}
          size="sm"
          variant="outline"
          onClick={() => void onRevoke()}
        >
          {pending && (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          )}
          {t("auth.revokeToken")}
        </Button>
      )}
    </div>
  );
}

function TokenListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
