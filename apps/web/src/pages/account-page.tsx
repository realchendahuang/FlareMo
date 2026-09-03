import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
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
  changeEmail,
  createPersonalAccessToken,
  deleteAccount,
  getCurrentFlareMoUser,
  getVectorUsage,
  listPersonalAccessTokens,
  type PersonalAccessToken,
  revokePersonalAccessToken,
  type VectorUsageReport,
} from "@/api";
import { authClient } from "@/auth-client";
import { SubpageHeader } from "@/components/subpage-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type TranslationKey, useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { AdminPanel } from "./admin-page";

const MIN_PASSWORD_LENGTH = 12;

type AccountTab = "profile" | "security" | "tokens" | "usage" | "admin";

export function AccountPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/account" });
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [tab, setTab] = useState<AccountTab>("profile");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailVerificationPending, setEmailVerificationPending] =
    useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      // The server deleted the account; every cached query is stale.
      queryClient.clear();
      await authClient.signOut().catch(() => undefined);
      await navigate({ replace: true, to: "/login" });
    },
  });
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
  const meQuery = useQuery({
    queryKey: ["current-flaremo-user"],
    queryFn: getCurrentFlareMoUser,
    retry: false,
  });
  const vectorUsageQuery = useQuery({
    queryKey: ["vector-usage"],
    queryFn: getVectorUsage,
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
  const changeEmailMutation = useMutation({
    mutationFn: changeEmail,
    onSuccess: async (result) => {
      // With an email provider configured the change is only staged: the new
      // address must confirm ownership before the login identity switches.
      setEmailVerificationPending(result.verification_sent === true);
      await session.refetch();
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

  const handleEmailSubmit = async () => {
    setEmailError(null);
    setEmailVerificationPending(false);
    try {
      await changeEmailMutation.mutateAsync({
        current_password: emailCurrentPassword,
        new_email: newEmail.trim(),
      });
      setNewEmail("");
      setEmailCurrentPassword("");
    } catch (error) {
      setEmailError(errorMessage(error, t("auth.emailUpdateFailed")));
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

  const isTeamAdmin =
    meQuery.data?.role === "owner" || meQuery.data?.role === "admin";

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <SubpageHeader />

        <section className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
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

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as AccountTab)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="profile">{t("auth.tab.profile")}</TabsTrigger>
            <TabsTrigger value="security">{t("auth.tab.security")}</TabsTrigger>
            <TabsTrigger value="tokens">{t("auth.tab.tokens")}</TabsTrigger>
            <TabsTrigger value="usage">{t("auth.tab.usage")}</TabsTrigger>
            {isTeamAdmin && (
              <TabsTrigger value="admin">{t("auth.tab.admin")}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("auth.profileTitle")}</CardTitle>
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
                    {t("auth.usernameHandle")}
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
                  <Button
                    disabled={updateUsernameMutation.isPending}
                    type="submit"
                  >
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
          </TabsContent>

          <TabsContent value="security" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("auth.passwordTitle")}</CardTitle>
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
                      onChange={(event) =>
                        setCurrentPassword(event.target.value)
                      }
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
                <CardTitle>{t("auth.emailTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {emailVerificationPending && (
                  <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                    {t("auth.emailChangeVerificationSent")}
                  </p>
                )}
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleEmailSubmit();
                  }}
                >
                  <label
                    className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"
                    htmlFor="account-new-email"
                  >
                    {t("auth.newEmail")}
                    <Input
                      autoCapitalize="none"
                      autoComplete="email"
                      disabled={changeEmailMutation.isPending}
                      id="account-new-email"
                      required
                      type="email"
                      value={newEmail}
                      onChange={(event) => setNewEmail(event.target.value)}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"
                    htmlFor="account-email-current-password"
                  >
                    {t("auth.currentPassword")}
                    <Input
                      autoComplete="current-password"
                      disabled={changeEmailMutation.isPending}
                      id="account-email-current-password"
                      required
                      type="password"
                      value={emailCurrentPassword}
                      onChange={(event) =>
                        setEmailCurrentPassword(event.target.value)
                      }
                    />
                  </label>
                  {emailError && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive sm:col-span-2">
                      {emailError}
                    </p>
                  )}
                  <div className="sm:col-span-2">
                    <Button
                      disabled={changeEmailMutation.isPending}
                      type="submit"
                    >
                      <RefreshCcwIcon data-icon="inline-start" />
                      {changeEmailMutation.isPending
                        ? t("auth.saving")
                        : t("auth.changeEmail")}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
            {meQuery.data?.role !== "owner" && (
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle>{t("auth.deleteAccountTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setDeleteError(null);
                      void deleteAccountMutation
                        .mutateAsync(deletePassword)
                        .then(() => setDeletePassword(""))
                        .catch((error: unknown) => {
                          setDeleteError(
                            errorMessage(error, t("auth.deleteAccountFailed")),
                          );
                        });
                    }}
                  >
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t("auth.deleteAccountDescription")}
                    </p>
                    <label
                      className="flex flex-col gap-1.5 text-sm font-medium"
                      htmlFor="account-delete-password"
                    >
                      {t("auth.deleteAccountPassword")}
                      <Input
                        autoComplete="current-password"
                        disabled={deleteAccountMutation.isPending}
                        id="account-delete-password"
                        required
                        type="password"
                        value={deletePassword}
                        onChange={(event) =>
                          setDeletePassword(event.target.value)
                        }
                      />
                    </label>
                    {deleteError && (
                      <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                        {deleteError}
                      </p>
                    )}
                    <Button
                      className="w-fit"
                      disabled={
                        deleteAccountMutation.isPending ||
                        deletePassword.length === 0
                      }
                      type="submit"
                      variant="destructive"
                    >
                      {deleteAccountMutation.isPending
                        ? t("auth.deleteAccountSubmitting")
                        : t("auth.deleteAccountSubmit")}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="tokens" className="mt-4">
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
                      onChange={(event) =>
                        setTokenExpiryDays(event.target.value)
                      }
                    />
                  </label>
                  <Button
                    disabled={createTokenMutation.isPending}
                    type="submit"
                  >
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
          </TabsContent>

          <TabsContent value="usage" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("usage.vectorTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {vectorUsageQuery.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : vectorUsageQuery.isError || !vectorUsageQuery.data ? (
                  <p className="text-sm text-muted-foreground">
                    {t("usage.vectorUnavailable")}
                  </p>
                ) : (
                  <VectorUsagePanel report={vectorUsageQuery.data} t={t} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {isTeamAdmin && (
            <TabsContent value="admin" className="mt-4">
              <AdminPanel />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

function VectorUsagePanel({
  report,
  t,
}: {
  report: VectorUsageReport;
  t: (key: TranslationKey) => string;
}) {
  const totalStored = report.indexes.reduce(
    (sum, index) => sum + index.stored_dimensions,
    0,
  );
  const totalVectors = report.indexes.reduce(
    (sum, index) => sum + index.vectors_count,
    0,
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <span className="text-muted-foreground">
          {t("usage.model")}: {report.model}
        </span>
        <span className="text-muted-foreground">
          {t("usage.dimensions")}: {report.dimensions}
        </span>
        <span className="text-muted-foreground">
          {t("usage.vectors")}: {totalVectors}
        </span>
      </div>
      <UsageBar
        label={t("usage.stored")}
        used={totalStored}
        limit={report.stored_limit}
      />
      <UsageBar
        label={t("usage.queried")}
        used={report.queried_dimensions_this_month}
        limit={report.queried_limit}
      />
      {report.plan && <PlanQuotaBars plan={report.plan} t={t} />}
      <p className="text-xs text-muted-foreground">{t("usage.disclaimer")}</p>
    </div>
  );
}

// Used-vs-limit rows for the injectable plan quotas. Rows with a null limit
// (self-hosted default) stay hidden so the panel stays noise-free; when every
// limit is null there is nothing to render.
type QuotaRow = {
  key: TranslationKey;
  used: number;
  limit: number | null;
  format: (value: number) => string;
};

const localeFormat = (value: number) => value.toLocaleString();

function PlanQuotaBars({
  plan,
  t,
}: {
  plan: NonNullable<VectorUsageReport["plan"]>;
  t: (key: TranslationKey) => string;
}) {
  const userRows: QuotaRow[] | null = plan.user
    ? [
        {
          key: "usage.planStorage",
          used: plan.user.usage.attachmentStorageBytes,
          limit: plan.user.limits.attachmentStorageBytes,
          format: formatBytes,
        },
        {
          key: "usage.planEmbeddingTokens",
          used: plan.user.usage.aiEmbeddingTokensPerMonth,
          limit: plan.user.limits.aiEmbeddingTokensPerMonth,
          format: localeFormat,
        },
        {
          key: "usage.planSearchQueries",
          used: plan.user.usage.semanticSearchQueriesPerMonth,
          limit: plan.user.limits.semanticSearchQueriesPerMonth,
          format: localeFormat,
        },
        {
          key: "usage.planMemos",
          used: plan.user.usage.maxMemosPerUser,
          limit: plan.user.limits.maxMemosPerUser,
          format: localeFormat,
        },
        {
          key: "usage.planMemories",
          used: plan.user.usage.maxMemoryItemsPerUser,
          limit: plan.user.limits.maxMemoryItemsPerUser,
          format: localeFormat,
        },
      ]
    : null;
  const userLimited = userRows?.filter((row) => row.limit !== null) ?? [];

  const deploymentRows: QuotaRow[] = [
    {
      key: "usage.planStorage",
      used: plan.usage.attachmentStorageBytes,
      limit: plan.limits.attachmentStorageBytes,
      format: formatBytes,
    },
    {
      key: "usage.planEmbeddingTokens",
      used: plan.usage.aiEmbeddingTokensPerMonth,
      limit: plan.limits.aiEmbeddingTokensPerMonth,
      format: localeFormat,
    },
    {
      key: "usage.planSearchQueries",
      used: plan.usage.semanticSearchQueriesPerMonth,
      limit: plan.limits.semanticSearchQueriesPerMonth,
      format: localeFormat,
    },
    {
      key: "usage.planMembers",
      used: plan.usage.maxMembersPerDeployment,
      limit: plan.limits.maxMembersPerDeployment,
      format: localeFormat,
    },
  ];
  const deploymentLimited = deploymentRows.filter((row) => row.limit !== null);

  if (userLimited.length === 0 && deploymentLimited.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      {userLimited.length > 0 && (
        <>
          <p className="text-sm font-medium">{t("usage.planUserTitle")}</p>
          {userLimited.map((row) => (
            <UsageBar
              key={`user-${row.key}`}
              label={t(row.key)}
              used={row.used}
              limit={row.limit as number}
              formatValue={row.format}
            />
          ))}
        </>
      )}
      {deploymentLimited.length > 0 && (
        <>
          <p className="text-sm font-medium">{t("usage.planTitle")}</p>
          {deploymentLimited.map((row) => (
            <UsageBar
              key={`deployment-${row.key}`}
              label={t(row.key)}
              used={row.used}
              limit={row.limit as number}
              formatValue={row.format}
            />
          ))}
        </>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function UsageBar({
  label,
  used,
  limit,
  formatValue,
}: {
  label: string;
  used: number;
  limit: number;
  formatValue?: (value: number) => string;
}) {
  const format = formatValue ?? ((value: number) => value.toLocaleString());
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-flame-500 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
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
