import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  ClipboardIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogOutIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  type PersonalAccessToken,
  revokePersonalAccessToken,
} from "@/api";
import { authClient } from "@/auth-client";
import { errorMessage } from "@/components/auth-page-frame";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type TranslationKey, useI18n } from "@/i18n";

const MIN_PASSWORD_LENGTH = 12;

export function AccountPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/account" });
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (session.data?.user.username) {
      setUsername(session.data.user.username);
    }
  }, [session.data?.user.username]);

  const tokensQuery = useQuery({
    queryKey: ["personal-access-tokens"],
    queryFn: listPersonalAccessTokens,
    retry: false,
  });
  const updateUsernameMutation = useMutation({
    mutationFn: async (nextUsername: string) => {
      const result = await authClient.updateUser({ username: nextUsername });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await session.refetch();
    },
  });
  const changePasswordMutation = useMutation({
    mutationFn: async (input: {
      currentPassword: string;
      newPassword: string;
    }) => {
      const result = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw result.error;
    },
  });
  const createTokenMutation = useMutation({
    mutationFn: createPersonalAccessToken,
    onSuccess: async (result) => {
      setCreatedToken(result.token);
      setCopied(false);
      setTokenName("");
      setTokenExpiryDays("");
      await queryClient.invalidateQueries({
        queryKey: ["personal-access-tokens"],
      });
    },
  });
  const revokeTokenMutation = useMutation({
    mutationFn: revokePersonalAccessToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["personal-access-tokens"],
      });
    },
  });

  const handleUsernameSubmit = async () => {
    setAccountError(null);
    try {
      await updateUsernameMutation.mutateAsync(username.trim());
    } catch (error) {
      setAccountError(errorMessage(error, t("auth.usernameUpdateFailed")));
    }
  };

  const handlePasswordSubmit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t("auth.passwordLength"));
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setPasswordError(t("auth.passwordMismatch"));
      return;
    }
    setPasswordError(null);
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
    } catch (error) {
      setPasswordError(errorMessage(error, t("auth.passwordUpdateFailed")));
    }
  };

  const handleCreateToken = async () => {
    const normalizedDays = tokenExpiryDays.trim();
    const expiresInDays = Number(normalizedDays);
    if (
      !tokenName.trim() ||
      (normalizedDays &&
        (!Number.isInteger(expiresInDays) ||
          expiresInDays < 1 ||
          expiresInDays > 365))
    ) {
      setTokenError(t("auth.tokenValidation"));
      return;
    }
    setTokenError(null);
    try {
      await createTokenMutation.mutateAsync({
        expires_in_days: normalizedDays ? expiresInDays : null,
        name: tokenName.trim(),
      });
    } catch (error) {
      setTokenError(errorMessage(error, t("auth.tokenCreateFailed")));
    }
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      setTokenError(t("auth.copyFailed"));
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ replace: true, to: "/login" });
  };

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link
              search={{
                q: undefined,
                tag: undefined,
                view: undefined,
                untagged: undefined,
              }}
              to="/"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {t("auth.backToWorkspace")}
            </Link>
          </Button>
          <FlareMoLogo markClassName="size-5" />
        </header>

        <section className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              {t("auth.nativeAccess")}
            </p>
            <h1 className="mt-1 font-heading text-2xl font-semibold">
              {t("auth.accountTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {session.data?.user.email}
            </p>
          </div>
          <Button variant="outline" onClick={() => void handleSignOut()}>
            <LogOutIcon data-icon="inline-start" />
            {t("auth.signOut")}
          </Button>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>{t("auth.profileTitle")}</CardTitle>
            <CardDescription>{t("auth.profileDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void handleUsernameSubmit();
              }}
            >
              <label
                className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium"
                htmlFor="account-username"
              >
                {t("auth.username")}
                <Input
                  autoCapitalize="none"
                  autoComplete="username"
                  disabled={updateUsernameMutation.isPending}
                  id="account-username"
                  maxLength={30}
                  minLength={3}
                  pattern="[A-Za-z0-9_]+"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <Button disabled={updateUsernameMutation.isPending} type="submit">
                {updateUsernameMutation.isPending
                  ? t("auth.saving")
                  : t("auth.saveUsername")}
              </Button>
            </form>
            {accountError && (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {accountError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("auth.passwordTitle")}</CardTitle>
            <CardDescription>{t("auth.passwordDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePasswordSubmit();
              }}
            >
              <label
                className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"
                htmlFor="account-current-password"
              >
                {t("auth.currentPassword")}
                <Input
                  autoComplete="current-password"
                  disabled={changePasswordMutation.isPending}
                  id="account-current-password"
                  required
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="account-new-password"
              >
                {t("auth.newPassword")}
                <Input
                  autoComplete="new-password"
                  disabled={changePasswordMutation.isPending}
                  id="account-new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="account-password-confirmation"
              >
                {t("auth.confirmPassword")}
                <Input
                  autoComplete="new-password"
                  disabled={changePasswordMutation.isPending}
                  id="account-password-confirmation"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  type="password"
                  value={newPasswordConfirmation}
                  onChange={(event) =>
                    setNewPasswordConfirmation(event.target.value)
                  }
                />
              </label>
              {passwordError && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive sm:col-span-2">
                  {passwordError}
                </p>
              )}
              <div className="sm:col-span-2">
                <Button
                  disabled={changePasswordMutation.isPending}
                  type="submit"
                >
                  <RefreshCcwIcon data-icon="inline-start" />
                  {changePasswordMutation.isPending
                    ? t("auth.saving")
                    : t("auth.changePassword")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("auth.tokensTitle")}</CardTitle>
            <CardDescription>{t("auth.tokensDescription")}</CardDescription>
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
                  <Button size="sm" onClick={() => void handleCopyToken()}>
                    {copied ? (
                      <CheckIcon data-icon="inline-start" />
                    ) : (
                      <ClipboardIcon data-icon="inline-start" />
                    )}
                    {copied ? t("auth.copied") : t("auth.copyToken")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCreatedToken(null)}
                  >
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
                void handleCreateToken();
              }}
            >
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="account-token-name"
              >
                {t("auth.tokenName")}
                <Input
                  disabled={createTokenMutation.isPending}
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
                  disabled={createTokenMutation.isPending}
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
              <Button disabled={createTokenMutation.isPending} type="submit">
                {createTokenMutation.isPending
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
                  pending={
                    revokeTokenMutation.isPending &&
                    revokeTokenMutation.variables === token.id
                  }
                  token={token}
                  onRevoke={async () => {
                    setTokenError(null);
                    try {
                      await revokeTokenMutation.mutateAsync(token.id);
                    } catch (error) {
                      setTokenError(
                        errorMessage(error, t("auth.tokenRevokeFailed")),
                      );
                    }
                  }}
                  t={t}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
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
