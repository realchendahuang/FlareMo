import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AppWindowMacIcon,
  ArrowDownUpIcon,
  BellRingIcon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  type LucideIcon,
  MicIcon,
  PaintbrushIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  changeEmail,
  createExportTask,
  createPersonalAccessToken,
  deleteAccount,
  deletePersonalAccessToken,
  getAdminBranding,
  getAppInfo,
  getCurrentFlareMoUser,
  getVectorUsage,
  getVoiceSettings,
  listAdminUsers,
  listDataTasks,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/api";
import { authClient } from "@/auth-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { InstallAppCard } from "./account/install-app-card";
import { ProfilePanel } from "./account/profile-panel";
import { PushPanel } from "./account/push-panel";
import { MIN_PASSWORD_LENGTH, SecurityPanel } from "./account/security-panel";
import { TokensPanel } from "./account/tokens-panel";
import { TransferPanel } from "./account/transfer-panel";
import { UsagePanel } from "./account/usage-panel";
import { AdminPanel, BrandingCard } from "./admin-page";

const VoicePanel = lazy(() =>
  import("./account/voice-panel").then((module) => ({
    default: module.VoicePanel,
  })),
);

type SettingsSection =
  | "profile"
  | "security"
  | "tokens"
  | "push"
  | "install"
  | "voice"
  | "usage"
  | "transfer"
  | "team"
  | "branding";

type NavItem = {
  id: SettingsSection;
  icon: LucideIcon;
  label: string;
};

// Matches the lazy VoicePanel's frame (title + description + a few rows) so
// the chunk download never pops the cards below it upward.
function VoicePanelSkeleton() {
  return (
    <div className="rounded-xl border">
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AccountSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const navigate = useNavigate({ from: "/account" });
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [section, setSection] = useState<SettingsSection>("profile");
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
    enabled: open,
  });
  const meQuery = useQuery({
    queryKey: ["current-flaremo-user"],
    queryFn: getCurrentFlareMoUser,
    retry: false,
    enabled: open,
  });
  // The workspace already holds this viewer under the same key, so opening
  // the account page renders from cache instead of paying another /me round
  // trip (and voice permission rides along for free).
  const showVoiceSettings = meQuery.data?.can_manage_voice_service === true;
  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: getAppInfo,
    staleTime: 10 * 60 * 1000,
    retry: false,
    enabled: open,
  });
  const vectorUsageQuery = useQuery({
    queryKey: ["vector-usage"],
    queryFn: getVectorUsage,
    retry: false,
    enabled: open,
    // The global config disables refetchOnWindowFocus; poll mildly so the
    // quota bars move during a heavy-search session.
    refetchInterval: 120_000,
  });
  const dataTasksQuery = useQuery({
    queryKey: ["data-tasks"],
    queryFn: listDataTasks,
    retry: false,
    enabled: open,
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
      // The renamed viewer feeds the account page, the admin list, and the
      // workspace header; refresh all cached copies.
      await queryClient.invalidateQueries({
        queryKey: ["current-flaremo-user"],
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
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
  const deleteTokenMutation = useMutation({
    mutationFn: deletePersonalAccessToken,
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

  const handleDeleteToken = async (id: string) => {
    setTokenError(null);
    try {
      await deleteTokenMutation.mutateAsync(id);
    } catch (error) {
      setTokenError(errorMessage(error, t("auth.tokenDeleteFailed")));
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
    try {
      await authClient.signOut();
    } catch {
      // Clearing local state is still the right move even if the server
      // call failed (offline); the cookie will be cleaned server-side later.
    }
    queryClient.clear();
    await navigate({ replace: true, to: "/login" });
  };

  const isTeamAdmin =
    meQuery.data?.role === "owner" || meQuery.data?.role === "admin";
  const isInstanceOwner = meQuery.data?.is_instance_owner === true;

  // Admin cards fetch on mount; warm both queries while the viewer is on
  // any section so switching to 品牌外观/团队管理 paints with data, not
  // skeletons. Voice settings rides along too: by the time the lazy
  // VoicePanel chunk lands, its config is already in cache.
  useEffect(() => {
    if (!open || !isTeamAdmin) return undefined;
    void queryClient.prefetchQuery({
      queryKey: ["admin-branding"],
      queryFn: getAdminBranding,
    });
    void queryClient.prefetchQuery({
      queryKey: ["admin-users"],
      queryFn: listAdminUsers,
    });
    return undefined;
  }, [isTeamAdmin, open, queryClient]);

  useEffect(() => {
    if (!open || meQuery.data?.can_manage_voice_service !== true) {
      return undefined;
    }
    void queryClient.prefetchQuery({
      queryKey: ["voice-settings"],
      queryFn: getVoiceSettings,
    });
    return undefined;
  }, [meQuery.data?.can_manage_voice_service, open, queryClient]);

  // Sidebar groups read top-down like macOS System Settings: identity first,
  // then preferences, data, and finally instance management. macOS separates
  // groups with whitespace only — no group captions.
  const navGroups: NavItem[][] = [
    [
      { icon: UserRoundIcon, id: "profile", label: t("settings.nav.profile") },
      {
        icon: ShieldCheckIcon,
        id: "security",
        label: t("settings.nav.security"),
      },
      { icon: KeyRoundIcon, id: "tokens", label: t("settings.nav.tokens") },
    ],
    [
      { icon: BellRingIcon, id: "push", label: t("settings.nav.push") },
      {
        icon: AppWindowMacIcon,
        id: "install",
        label: t("settings.nav.install"),
      },
      ...(showVoiceSettings
        ? [
            {
              icon: MicIcon,
              id: "voice" as const,
              label: t("settings.nav.voice"),
            },
          ]
        : []),
    ],
    [
      { icon: GaugeIcon, id: "usage", label: t("auth.tab.usage") },
      {
        icon: ArrowDownUpIcon,
        id: "transfer",
        label: t("settings.nav.transfer"),
      },
    ],
    ...(isTeamAdmin
      ? [
          [
            {
              icon: UsersIcon,
              id: "team" as const,
              label: t("auth.tab.admin"),
            },
            ...(isInstanceOwner
              ? [
                  {
                    icon: PaintbrushIcon,
                    id: "branding" as const,
                    label: t("auth.tab.branding"),
                  },
                ]
              : []),
          ],
        ]
      : []),
  ];

  const activeSection = navGroups.flat().find((item) => item.id === section);
  const activeLabel = activeSection?.label ?? t("settings.nav.profile");

  const contentBySection: Record<SettingsSection, ReactNode> = {
    profile: (
      <ProfilePanel
        currentUsername={session.data?.user.username ?? ""}
        error={accountError}
        isPending={updateUsernameMutation.isPending}
        setUsername={setUsername}
        t={t}
        username={username}
        onSubmit={handleUsernameSubmit}
      />
    ),
    security: (
      <SecurityPanel
        emailProviderDisabled={appInfoQuery.data?.email_provider === "none"}
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
        isOwner={isInstanceOwner}
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
    ),
    tokens: (
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
        deletingTokenId={
          deleteTokenMutation.isPending
            ? deleteTokenMutation.variables
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
        onDeleteToken={handleDeleteToken}
        onHideCreatedToken={() => setCreatedToken(null)}
      />
    ),
    push: <PushPanel />,
    install: <InstallAppCard />,
    voice: showVoiceSettings ? (
      <Suspense fallback={<VoicePanelSkeleton />}>
        <VoicePanel key={session.data?.user.id} />
      </Suspense>
    ) : null,
    usage: <UsagePanel t={t} vectorUsageQuery={vectorUsageQuery} />,
    transfer: (
      <TransferPanel
        dataTasksQuery={dataTasksQuery}
        createExportIsPending={retryExportMutation.isPending}
        retryExportIsPending={retryExportMutation.isPending}
        t={t}
        onCreateExport={() => retryExportMutation.mutate()}
        onRetryExport={() => retryExportMutation.mutate()}
      />
    ),
    team: isTeamAdmin ? <AdminPanel /> : null,
    branding: isInstanceOwner ? <BrandingCard /> : null,
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="flex h-svh max-h-svh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(46rem,calc(100svh-4rem))] sm:max-h-[calc(100svh-4rem)] sm:max-w-4xl sm:flex-row sm:rounded-2xl">
        <aside className="flex shrink-0 flex-col gap-2 border-b bg-muted/40 p-3 sm:w-60 sm:border-b-0 sm:border-r sm:p-4">
          <DialogTitle className="px-2 pt-1 text-lg font-semibold tracking-tight">
            {t("settings.title")}
          </DialogTitle>
          <div className="hidden items-center gap-3 px-2 pb-1 sm:flex">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
              {(session.data?.user.username ?? "?").slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {session.data?.user.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {session.data?.user.email}
              </p>
            </div>
          </div>
          <nav className="flex gap-3 overflow-x-auto pb-1 sm:flex-col sm:gap-4 sm:overflow-y-auto sm:overflow-x-visible sm:pb-0">
            {navGroups.map((group) => (
              <div className="flex gap-1 sm:flex-col" key={group[0].id}>
                {group.map((item) => (
                  <NavButton
                    active={section === item.id}
                    icon={item.icon}
                    key={item.id}
                    label={item.label}
                    onSelect={() => setSection(item.id)}
                  />
                ))}
              </div>
            ))}
          </nav>
          <div className="mt-auto pt-2">
            <Button
              className="w-full"
              onClick={() => void handleSignOut()}
              variant="outline"
            >
              <LogOutIcon data-icon="inline-start" />
              {t("auth.signOut")}
            </Button>
          </div>
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-5 py-5 sm:px-8 sm:py-7">
            <h2 className="pr-8 font-heading text-lg font-semibold tracking-tight">
              {activeLabel}
            </h2>
            <div className="mt-4 flex flex-col gap-4">
              {contentBySection[section]}
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function AccountPage() {
  const navigate = useNavigate({ from: "/account" });
  return (
    <AccountSettingsDialog
      open
      onClose={() =>
        void navigate({
          search: {
            compose: undefined,
            q: undefined,
            space: undefined,
            tag: undefined,
            untagged: undefined,
            view: undefined,
          },
          to: "/",
        })
      }
    />
  );
}
