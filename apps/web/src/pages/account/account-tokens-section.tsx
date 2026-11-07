import {
  type MemosPatScope,
  PERMANENT_MEMOS_PAT_EXPIRES_IN_DAYS,
} from "@flaremo/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import type { PersonalAccessToken } from "@/api";
import { SecretRevealDialog } from "@/components/secret-reveal-dialog";
import { SettingsSectionGroup } from "@/components/settings-section";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { TranslationKey, TranslationParams } from "@/i18n";
import { formatDateTime } from "@/lib/date-format";
import { useCloseOnSuccess } from "./account-panel-presets";

/** The personal access token group, its create dialog and the one-time reveal,
 *  plus the row that can revoke or delete a single token. */
type AccountTokensSectionProps = {
  copied: boolean;
  createTokenIsPending: boolean;
  createdToken: string | null;
  deletingTokenId: string | undefined;
  locale: string;
  revokingTokenId: string | undefined;
  setTokenExpiryDays: (value: string) => void;
  setTokenName: (value: string) => void;
  setTokenScopes: (value: MemosPatScope[]) => void;
  tokenError: string | null;
  tokenExpiryDays: string;
  tokenName: string;
  tokenScopes: MemosPatScope[];
  tokensQuery: UseQueryResult<
    { personal_access_tokens: PersonalAccessToken[] },
    Error
  >;
  onCopyToken: () => Promise<void>;
  onCreateToken: () => Promise<void>;
  onRevokeToken: (id: string) => Promise<void>;
  onDeleteToken: (id: string) => Promise<void>;
  onHideCreatedToken: () => void;

  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function AccountTokensSection({
  copied,
  createTokenIsPending,
  createdToken,
  deletingTokenId,
  locale,
  revokingTokenId,
  setTokenExpiryDays,
  setTokenName,
  setTokenScopes,
  tokenError,
  tokenExpiryDays,
  tokenName,
  tokenScopes,
  tokensQuery,
  onCopyToken,
  onCreateToken,
  onRevokeToken,
  onDeleteToken,
  onHideCreatedToken,

  t,
}: AccountTokensSectionProps) {
  const [createTokenOpen, setCreateTokenOpen] = useState(false);
  const adminScoped = tokenScopes.includes("admin");
  const permanent =
    tokenExpiryDays === String(PERMANENT_MEMOS_PAT_EXPIRES_IN_DAYS);

  // Auto-close dialogs on mutation success
  useCloseOnSuccess(createTokenIsPending, tokenError !== null, () =>
    setCreateTokenOpen(false),
  );

  return (
    <>
      <SettingsSectionGroup
        title={
          <div className="flex items-center justify-between">
            <span>{t("auth.tokensTitle")}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setCreateTokenOpen(true)}
            >
              <PlusIcon data-icon="inline-start" className="size-3.5" />
              {t("auth.createToken")}
            </Button>
          </div>
        }
      >
        {tokenError && (
          <div className="p-3">
            <Alert variant="destructive">{tokenError}</Alert>
          </div>
        )}

        {tokensQuery.isLoading && <TokenListSkeleton />}
        {tokensQuery.isError && (
          <div className="p-4 text-sm text-destructive">
            {t("auth.tokensLoadFailed")}
          </div>
        )}
        {tokensQuery.data?.personal_access_tokens.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("auth.noTokens")}
          </div>
        )}
        {tokensQuery.data?.personal_access_tokens.map((token) => (
          <PersonalAccessTokenRow
            key={token.id}
            deleting={deletingTokenId === token.id}
            locale={locale}
            pending={revokingTokenId === token.id}
            token={token}
            onRevoke={() => onRevokeToken(token.id)}
            onDelete={() => onDeleteToken(token.id)}
            t={t}
          />
        ))}
      </SettingsSectionGroup>

      {/* Create Token Dialog */}
      <Dialog open={createTokenOpen} onOpenChange={setCreateTokenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.createToken")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateToken();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="token-name"
            >
              {t("auth.tokenName")}
              <Input
                autoComplete="off"
                disabled={createTokenIsPending}
                id="token-name"
                maxLength={64}
                required
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="token-scopes"
            >
              {t("auth.tokenScopes")}
              <Select
                disabled={createTokenIsPending}
                id="token-scopes"
                value={tokenScopes.includes("admin") ? "admin" : "notes"}
                onChange={(event) => {
                  const next = event.target.value as MemosPatScope;
                  setTokenScopes([next]);
                  // A permanent token may only carry the notes scope. Clear
                  // the opt-in when the user switches to admin.
                  if (next === "admin" && permanent) setTokenExpiryDays("");
                }}
              >
                <option value="notes">{t("auth.tokenScopeNotes")}</option>
                <option value="admin">{t("auth.tokenScopeAdmin")}</option>
              </Select>
              <span className="text-xs font-normal text-muted-foreground">
                {adminScoped
                  ? t("auth.tokenScopeAdminHint")
                  : t("auth.tokenScopeNotesHint")}
              </span>
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="token-expiry"
            >
              {t("auth.tokenExpiry")}
              <Input
                autoComplete="off"
                disabled={createTokenIsPending || permanent}
                id="token-expiry"
                max={365}
                min={1}
                placeholder="365"
                type="number"
                value={permanent ? "" : tokenExpiryDays}
                onChange={(event) => setTokenExpiryDays(event.target.value)}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {t("auth.tokenExpiryHint")}
              </span>
            </label>
            <label
              className="flex items-center justify-between gap-3 text-sm font-medium"
              htmlFor="token-permanent"
            >
              <span>{t("auth.tokenPermanent")}</span>
              <Switch
                aria-label={t("auth.tokenPermanent")}
                checked={permanent}
                disabled={createTokenIsPending || adminScoped}
                id="token-permanent"
                onCheckedChange={(checked) =>
                  setTokenExpiryDays(
                    checked ? String(PERMANENT_MEMOS_PAT_EXPIRES_IN_DAYS) : "",
                  )
                }
              />
            </label>
            <DialogFooter className="mt-2">
              <Button
                disabled={createTokenIsPending}
                type="button"
                variant="outline"
                onClick={() => setCreateTokenOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={createTokenIsPending} type="submit">
                {createTokenIsPending && <Spinner data-icon="inline-start" />}
                {createTokenIsPending
                  ? t("auth.creatingToken")
                  : t("auth.createToken")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Secret Reveal Dialog (PAT once-only reveal) */}
      <SecretRevealDialog
        closeLabelKey="auth.hideToken"
        copied={copied}
        copyLabelKey="auth.copyToken"
        description={t("auth.tokenShownOnceDescription")}
        onCopy={() => void onCopyToken()}
        onOpenChange={(open) => {
          if (!open) onHideCreatedToken();
        }}
        open={createdToken !== null}
        t={t}
        titleKey="auth.tokenShownOnce"
        value={createdToken ?? ""}
      />
    </>
  );
}

function PersonalAccessTokenRow({
  deleting,
  locale,
  pending,
  t,
  token,
  onRevoke,
  onDelete,
}: {
  deleting: boolean;
  locale: string;
  pending: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  token: PersonalAccessToken;
  onRevoke: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const expiry = token.expires_at
    ? formatDateTime(token.expires_at, locale)
    : t("auth.never");

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-accent/20">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {token.name ?? t("auth.unnamedToken")}
          </p>
          <Badge
            variant={token.enabled ? "secondary" : "outline"}
            className="text-xs h-5 px-1.5"
          >
            {token.enabled ? t("auth.active") : t("auth.revoked")}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground truncate">
          {token.prefix ?? "memos_pat_"}
          {token.start ? `${token.start}…` : ""} · {t("auth.expires")}: {expiry}
          {" · "}
          {token.scopes.includes("admin")
            ? t("auth.tokenScopeAdmin")
            : t("auth.tokenScopeNotes")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {token.enabled && (
          <Button
            disabled={pending || deleting}
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setConfirmingRevoke(true)}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {t("auth.revokeToken")}
          </Button>
        )}
        <Button
          disabled={pending || deleting}
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          {deleting && <Spinner data-icon="inline-start" />}
          {t("common.delete")}
        </Button>
      </div>

      <AlertDialog open={confirmingRevoke} onOpenChange={setConfirmingRevoke}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.revokeToken")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("auth.revokeTokenConfirm", {
                name: token.name ?? t("auth.unnamedToken"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setConfirmingRevoke(false);
                void onRevoke();
              }}
            >
              {t("auth.revokeToken")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.deleteToken")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("auth.deleteTokenConfirm", {
                name: token.name ?? t("auth.unnamedToken"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                setConfirmingDelete(false);
                void onDelete();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TokenListSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border/40">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
