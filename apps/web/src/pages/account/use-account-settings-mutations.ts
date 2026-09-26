import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  changeEmail,
  createExportTask,
  createPersonalAccessToken,
  deleteAccount,
  deleteAvatar,
  deletePersonalAccessToken,
  revokePersonalAccessToken,
  updateCurrentUserProfile,
  uploadAvatar,
} from "@/api";
import { authClient } from "@/auth-client";
import { useSignOut } from "@/hooks/use-sign-out";
import type { TranslationKey, TranslationParams } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { MIN_PASSWORD_LENGTH } from "./account-panel-presets";

/**
 * The settings dialog's server writes: the eleven mutations the panel, the
 * transfer card and the shell fire, and the handlers that validate input and
 * report failures into the form state the sections render. Delete-account and
 * sign-out are shared by two call sites — the panel's danger zone and the
 * shell's sign-out rows — so they live here rather than in either section.
 * The translator comes from the shell so every message keeps using the exact
 * function the dialog was rendered with.
 */
export function useAccountSettingsMutations({
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
}: {
  username: string;
  name: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  newEmail: string;
  emailCurrentPassword: string;
  tokenName: string;
  tokenExpiryDays: string;
  createdToken: string | null;
  deletePassword: string;
  session: ReturnType<typeof authClient.useSession>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  setAccountError: (value: string | null) => void;
  setNameError: (value: string | null) => void;
  setAvatarError: (value: string | null) => void;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirmation: (value: string) => void;
  setPasswordError: (value: string | null) => void;
  setEmailError: (value: string | null) => void;
  setEmailCurrentPassword: (value: string) => void;
  setNewEmail: (value: string) => void;
  setEmailVerificationPending: (value: boolean) => void;
  setDeleteError: (value: string | null) => void;
  setDeletePassword: (value: string) => void;
  setTokenError: (value: string | null) => void;
  setCreatedToken: (value: string | null) => void;
  copyToken: (text: string) => Promise<boolean>;
  resetCopied: () => void;
  setTokenName: (value: string) => void;
  setTokenExpiryDays: (value: string) => void;
}) {
  const navigate = useNavigate({ from: "/account" });
  const queryClient = useQueryClient();

  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      queryClient.clear();
      await authClient.signOut().catch(() => undefined);
      await navigate({ replace: true, to: "/login" });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: updateCurrentUserProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentUser,
      });
      await session.refetch();
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentUser,
      });
      await session.refetch();
    },
  });

  const deleteAvatarMutation = useMutation({
    mutationFn: deleteAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentUser,
      });
      await session.refetch();
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentUser,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
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
      setEmailVerificationPending(result.verification_sent === true);
      await session.refetch();
    },
  });

  const createTokenMutation = useMutation({
    mutationFn: createPersonalAccessToken,
    onSuccess: async (result) => {
      setCreatedToken(result.token);
      resetCopied();
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

  const handleNameSubmit = async () => {
    setNameError(null);
    try {
      await updateProfileMutation.mutateAsync({ name: name.trim() });
    } catch (error) {
      setNameError(errorMessage(error, t("auth.nameUpdateFailed")));
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setAvatarError(null);
    try {
      await uploadAvatarMutation.mutateAsync(file);
    } catch (error) {
      setAvatarError(errorMessage(error, t("auth.avatarUpdateFailed")));
    }
  };

  const handleAvatarUrlSubmit = async (url: string) => {
    setAvatarError(null);
    try {
      await updateProfileMutation.mutateAsync({ avatar_url: url.trim() });
    } catch (error) {
      setAvatarError(errorMessage(error, t("auth.avatarUpdateFailed")));
    }
  };

  const handleAvatarDelete = async () => {
    setAvatarError(null);
    try {
      await deleteAvatarMutation.mutateAsync();
    } catch (error) {
      setAvatarError(errorMessage(error, t("auth.avatarUpdateFailed")));
    }
  };

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
    const ok = await copyToken(createdToken);
    if (!ok) setTokenError(t("auth.copyFailed"));
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
    // Resolve to whether deletion succeeded so the dialog can keep itself
    // open on failure; onSuccess signs out and navigates away, so a resolved
    // true never reaches the dialog's then-handler as a visible no-op.
    return deleteAccountMutation
      .mutateAsync(deletePassword)
      .then(() => {
        setDeletePassword("");
        return true;
      })
      .catch((error: unknown) => {
        setDeleteError(errorMessage(error, t("auth.deleteAccountFailed")));
        return false;
      });
  };

  const handleSignOut = useSignOut();

  return {
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
  };
}
