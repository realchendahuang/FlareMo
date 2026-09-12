import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  changeEmail,
  createExportTask,
  createPersonalAccessToken,
  deleteAccount,
  getCurrentFlareMoUser,
  getVectorUsage,
  listDataTasks,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/api";
import { authClient } from "@/auth-client";
import { SubpageHeader } from "@/components/subpage-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { InstallAppCard } from "./account/install-app-card";
import { ProfilePanel } from "./account/profile-panel";
import { MIN_PASSWORD_LENGTH, SecurityPanel } from "./account/security-panel";
import { TokensPanel } from "./account/tokens-panel";
import { TransferPanel } from "./account/transfer-panel";
import { UsagePanel } from "./account/usage-panel";
import { AdminPanel, BrandingCard } from "./admin-page";

type AccountTab = "account" | "usage" | "branding" | "admin";

export function AccountPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/account" });
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [tab, setTab] = useState<AccountTab>("account");
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
  const dataTasksQuery = useQuery({
    queryKey: ["data-tasks"],
    queryFn: listDataTasks,
    retry: false,
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? [];
      return tasks.some(
        (task) => task.status === "queued" || task.status === "running",
      )
        ? 5_000
        : false;
    },
  });
  const retryExportMutation = useMutation({
    mutationFn: createExportTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["data-tasks"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("transfer.retryFailed"))),
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

  const handleRevokeToken = async (id: string) => {
    setTokenError(null);
    try {
      await revokeTokenMutation.mutateAsync(id);
    } catch (error) {
      setTokenError(errorMessage(error, t("auth.tokenRevokeFailed")));
    }
  };

  const handleDeleteAccount = () => {
    setDeleteError(null);
    return deleteAccountMutation
      .mutateAsync(deletePassword)
      .then(() => setDeletePassword(""))
      .catch((error: unknown) => {
        setDeleteError(errorMessage(error, t("auth.deleteAccountFailed")));
      });
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
            <TabsTrigger value="account">{t("auth.tab.account")}</TabsTrigger>
            <TabsTrigger value="usage">{t("auth.tab.usage")}</TabsTrigger>
            {isTeamAdmin && (
              <TabsTrigger value="branding">
                {t("auth.tab.branding")}
              </TabsTrigger>
            )}
            {isTeamAdmin && (
              <TabsTrigger value="admin">{t("auth.tab.admin")}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="account" className="mt-4">
            <div className="flex flex-col gap-4">
              <ProfilePanel
                currentUsername={session.data?.user.username ?? ""}
                error={accountError}
                isPending={updateUsernameMutation.isPending}
                setUsername={setUsername}
                t={t}
                username={username}
                onSubmit={handleUsernameSubmit}
              />

              <InstallAppCard />

              <SecurityPanel
                changeEmailIsPending={changeEmailMutation.isPending}
                changePasswordIsPending={changePasswordMutation.isPending}
                currentEmail={session.data?.user.email ?? ""}
                currentPassword={currentPassword}
                deleteAccountIsPending={deleteAccountMutation.isPending}
                deleteError={deleteError}
                deletePassword={deletePassword}
                emailCurrentPassword={emailCurrentPassword}
                emailError={emailError}
                emailVerificationPending={emailVerificationPending}
                isOwner={meQuery.data?.role === "owner"}
                newPassword={newPassword}
                newPasswordConfirmation={newPasswordConfirmation}
                passwordError={passwordError}
                setCurrentPassword={setCurrentPassword}
                setDeletePassword={setDeletePassword}
                setEmailCurrentPassword={setEmailCurrentPassword}
                setNewEmail={setNewEmail}
                setNewPassword={setNewPassword}
                setNewPasswordConfirmation={setNewPasswordConfirmation}
                t={t}
                newEmail={newEmail}
                onEmailSubmit={handleEmailSubmit}
                onPasswordSubmit={handlePasswordSubmit}
                onDeleteAccount={handleDeleteAccount}
              />

              <TokensPanel
                copied={copied}
                createTokenIsPending={createTokenMutation.isPending}
                createdToken={createdToken}
                locale={locale}
                revokingTokenId={
                  revokeTokenMutation.isPending
                    ? revokeTokenMutation.variables
                    : undefined
                }
                setTokenExpiryDays={setTokenExpiryDays}
                setTokenName={setTokenName}
                t={t}
                tokenError={tokenError}
                tokenExpiryDays={tokenExpiryDays}
                tokenName={tokenName}
                tokensQuery={tokensQuery}
                onCopyToken={handleCopyToken}
                onCreateToken={handleCreateToken}
                onRevokeToken={handleRevokeToken}
                onHideCreatedToken={() => setCreatedToken(null)}
              />

              <TransferPanel
                dataTasksQuery={dataTasksQuery}
                createExportIsPending={retryExportMutation.isPending}
                retryExportIsPending={retryExportMutation.isPending}
                t={t}
                onCreateExport={() => retryExportMutation.mutate()}
                onRetryExport={() => retryExportMutation.mutate()}
              />
            </div>
          </TabsContent>

          <TabsContent value="usage" className="mt-4">
            <UsagePanel t={t} vectorUsageQuery={vectorUsageQuery} />
          </TabsContent>

          {isTeamAdmin && (
            <TabsContent value="branding" className="mt-4">
              <BrandingCard />
            </TabsContent>
          )}

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
