import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getAdminBranding,
  getAdminPluginSettings,
  getAppInfo,
  getCloudflareUsage,
  getCurrentFlareMoUser,
  getVectorUsage,
  getVoiceSettings,
  listAdminUsers,
  listDataTasks,
  listPersonalAccessTokens,
} from "@/api";
import { authClient } from "@/auth-client";
import { useClipboard } from "@/hooks/use-clipboard";
import { useI18n } from "@/i18n";
import { queryKeys } from "@/lib/query-keys";
import type { AccountPanelProps } from "./account-panel";
import type { SettingsSection } from "./settings-nav";
import { settingsNavGroups } from "./settings-nav";
import { useAccountSettingsMutations } from "./use-account-settings-mutations";

/**
 * Everything the settings dialog's shell renders but does not own: section
 * and mobile master/detail navigation, the form state for every account
 * section, the queries the detail panes read, the mutations hook, and the
 * assembled `accountPanel` prop bundle. `open` gates every query so a closed
 * dialog costs nothing.
 */
export function useAccountPageState({
  open,
  initialSection,
}: {
  open: boolean;
  initialSection?: string;
}) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [section, setSection] = useState<SettingsSection>("account");
  const [mobileView, setMobileView] = useState<"master" | "detail">("master");

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailVerificationPending, setEmailVerificationPending] =
    useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  // Success surfaces through the dialog's copied label (no toast); failure is
  // reported into the token form error slot, and the flag persists until the
  // next token is minted.
  const {
    copied,
    copy: copyToken,
    reset: resetCopied,
  } = useClipboard({
    successMessage: null,
    errorMessage: null,
    timeout: null,
  });

  // Reset mobile view to master whenever the dialog opens fresh
  useEffect(() => {
    if (open) {
      setMobileView("master");
    }
  }, [open]);

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
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
    retry: false,
    enabled: open,
  });

  useEffect(() => {
    if (meQuery.data?.name) {
      setName(meQuery.data.name);
    } else if (session.data?.user.name) {
      setName(session.data.user.name);
    }
  }, [meQuery.data?.name, session.data?.user.name]);

  const {
    changeEmailMutation,
    changePasswordMutation,
    createTokenMutation,
    deleteAccountMutation,
    deleteAvatarMutation,
    deleteTokenMutation,
    retryExportMutation,
    revokeTokenMutation,
    updateProfileMutation,
    updateUsernameMutation,
    uploadAvatarMutation,

    handleAvatarDelete,
    handleAvatarUpload,
    handleAvatarUrlSubmit,
    handleCopyToken,
    handleCreateToken,
    handleDeleteAccount,
    handleDeleteToken,
    handleEmailSubmit,
    handleNameSubmit,
    handlePasswordSubmit,
    handleRevokeToken,
    handleSignOut,
    handleUsernameSubmit,
  } = useAccountSettingsMutations({
    createdToken,
    currentPassword,
    deletePassword,
    emailCurrentPassword,
    name,
    newEmail,
    newPassword,
    newPasswordConfirmation,
    session,
    setAccountError,
    setAvatarError,
    copyToken,
    resetCopied,
    setCreatedToken,
    setCurrentPassword,
    setDeleteError,
    setDeletePassword,
    setEmailCurrentPassword,
    setEmailError,
    setEmailVerificationPending,
    setNameError,
    setNewEmail,
    setNewPassword,
    setNewPasswordConfirmation,
    setPasswordError,
    setTokenError,
    setTokenExpiryDays,
    setTokenName,
    t,
    tokenExpiryDays,
    tokenName,
    username,
  });

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
    refetchInterval: 120_000,
  });

  const cfUsageQuery = useQuery({
    queryKey: ["cloudflare-usage"],
    queryFn: getCloudflareUsage,
    retry: false,
    enabled: open,
    // The worker caches analytics for an hour; polling harder is waste.
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
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

  const isTeamAdmin =
    meQuery.data?.role === "owner" || meQuery.data?.role === "admin";
  const isInstanceOwner = meQuery.data?.is_instance_owner === true;

  useEffect(() => {
    if (!open || !isTeamAdmin) return undefined;
    void queryClient.prefetchQuery({
      queryKey: queryKeys.adminBranding,
      queryFn: getAdminBranding,
    });
    void queryClient.prefetchQuery({
      queryKey: ["admin-plugins"],
      queryFn: getAdminPluginSettings,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.adminUsers,
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

  const navGroups = settingsNavGroups({
    t,
    showVoiceSettings,
    isTeamAdmin,
    isInstanceOwner,
  });

  const allItems = navGroups.flatMap((group) => group.items);
  const activeSection = allItems.find((item) => item.id === section);
  const activeLabel = activeSection?.label ?? t("settings.group.account");

  // A deep link's section applies once it is actually visible to this viewer
  // (voice/admin entries appear only after `meQuery` resolves).
  const initialSectionVisible = allItems.some(
    (item) => item.id === initialSection,
  );
  useEffect(() => {
    if (!open || !initialSection || !initialSectionVisible) return;
    setSection(initialSection as SettingsSection);
    setMobileView("detail");
  }, [open, initialSection, initialSectionVisible]);

  const accountPanel: AccountPanelProps = {
    currentAvatarUrl:
      meQuery.data?.avatar_url ?? session.data?.user.image ?? null,
    currentName:
      meQuery.data?.name ??
      session.data?.user.name ??
      session.data?.user.username ??
      "",
    name,
    setName,
    onNameSubmit: handleNameSubmit,
    updateNameIsPending: updateProfileMutation.isPending,
    nameError,
    avatarError,
    avatarIsPending:
      uploadAvatarMutation.isPending ||
      deleteAvatarMutation.isPending ||
      updateProfileMutation.isPending,
    onAvatarUpload: handleAvatarUpload,
    onAvatarUrlSubmit: handleAvatarUrlSubmit,
    onAvatarDelete: handleAvatarDelete,
    accountError,
    changeEmailIsPending: changeEmailMutation.isPending,
    changePasswordIsPending: changePasswordMutation.isPending,
    copied,
    createTokenIsPending: createTokenMutation.isPending,
    createdToken,
    currentEmail: session.data?.user.email ?? "",
    currentPassword,
    currentUsername: session.data?.user.username ?? "",
    deleteAccountIsPending: deleteAccountMutation.isPending,
    deleteError,
    deletePassword,
    deletingTokenId: deleteTokenMutation.isPending
      ? deleteTokenMutation.variables
      : undefined,
    emailCurrentPassword,
    emailError,
    emailProviderDisabled: appInfoQuery.data?.email_provider === "none",
    emailVerificationPending,
    isOwner: isInstanceOwner,
    locale,
    newEmail,
    newPassword,
    newPasswordConfirmation,
    passwordError,
    readerExpiry:
      meQuery.data?.role === "reader"
        ? (meQuery.data.reader_expires_at ?? null)
        : null,
    revokingTokenId: revokeTokenMutation.isPending
      ? revokeTokenMutation.variables
      : undefined,
    setCurrentPassword,
    setDeletePassword,
    setEmailCurrentPassword,
    setNewEmail,
    setNewPassword,
    setNewPasswordConfirmation,
    setTokenExpiryDays,
    setTokenName,
    setUsername,
    t,
    tokenError,
    tokenExpiryDays,
    tokenName,
    tokensQuery,
    updateUsernameIsPending: updateUsernameMutation.isPending,
    username,
    onCopyToken: async () => {
      await handleCopyToken();
    },
    onCreateToken: handleCreateToken,
    // The credentials section narrows the promise to a boolean so its dialog
    // only closes on a successful delete; keep that contract intact here.
    onDeleteAccount: handleDeleteAccount,
    onDeleteToken: handleDeleteToken,
    onEmailSubmit: handleEmailSubmit,
    onHideCreatedToken: () => setCreatedToken(null),
    onPasswordSubmit: handlePasswordSubmit,
    onRevokeToken: handleRevokeToken,
    onUsernameSubmit: handleUsernameSubmit,
  };

  return {
    accountPanel,
    activeLabel,
    cfUsageQuery,
    dataTasksQuery,
    handleSignOut,
    isInstanceOwner,
    isTeamAdmin,
    meQuery,
    mobileView,
    navGroups,
    retryExportMutation,
    section,
    session,
    setMobileView,
    setSection,
    showVoiceSettings,
    t,
    vectorUsageQuery,
  };
}
