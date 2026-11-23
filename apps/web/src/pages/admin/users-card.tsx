import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AdminUser,
  getCurrentFlareMoUser,
  listAdminUsers,
  requestAdminPasswordReset,
} from "@/api";
import { useClipboard } from "@/hooks/use-clipboard";
import { useI18n } from "@/i18n";
import { errorMessage, isEmailInUseError } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { readerExpiryBase, useAdminUserMutations } from "./use-admin-users";
import { UsersDialogs } from "./users-card/users-dialogs";
import { UsersTable } from "./users-card/users-table";

/**
 * Admin users card (former monolithic users-card.tsx). State, queries and
 * row-action handlers live here verbatim; the member list renders via
 * users-table.tsx and the modals via users-dialogs.tsx. Exported as
 * AdminPanel — preserved under the original "./admin/users-card" path so
 * admin-page.tsx keeps importing it unchanged.
 */
export function AdminPanel() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  // No toast on success (the dialog's own copied label reports it) and no
  // auto-reset (a one-time reset link must keep its "copied" state).
  const {
    copied,
    copy: copyLink,
    reset: resetCopied,
  } = useClipboard({
    successMessage: null,
    timeout: null,
    errorMessage: t("admin.resetCopyFailed"),
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: listAdminUsers,
    retry: false,
  });
  const meQuery = useQuery({
    // Same key as the account page's viewer cache so both views invalidate
    // together after a role change.
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
  });
  // The role matrix the server enforces: only the team owner changes roles,
  // and only the owner resets another administrator's password or removes one.
  const isTeamOwner = meQuery.data?.role === "owner";
  const isTeamAdmin = isTeamOwner || meQuery.data?.role === "admin";

  const {
    createUserMutation,
    deleteUserMutation,
    updateRoleMutation,
    setReaderMutation,
    revokeReaderMutation,
  } = useAdminUserMutations();

  const handleCreateUser = async () => {
    setCreateError(null);
    try {
      const result = await createUserMutation.mutateAsync({
        name: name.trim(),
        email: email.trim(),
      });
      setName("");
      setEmail("");
      setCreatedLink(`${window.location.origin}${result.activation_path}`);
      resetCopied();
      setCreateOpen(false);
    } catch (error) {
      setCreateError(
        isEmailInUseError(error)
          ? t("common.emailInUse")
          : errorMessage(error, t("admin.userCreateFailed")),
      );
    }
  };

  // Row-action failures surface as toasts: the create dialog's error slot is
  // only rendered while that dialog is open, so writing row failures there
  // made them invisible.
  const handleDeleteUser = async (user: AdminUser) => {
    try {
      await deleteUserMutation.mutateAsync(user.id);
      toast.success(t("admin.userDeleted"));
    } catch (error) {
      toast.error(errorMessage(error, t("admin.userDeleteFailed")));
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    try {
      const result = await requestAdminPasswordReset(user.id);
      const base = window.location.origin;
      setResetLink(`${base}${result.reset_path}`);
      resetCopied();
    } catch (error) {
      toast.error(errorMessage(error, t("admin.resetFailed")));
    }
  };

  const handleUpdateRole = async (user: AdminUser) => {
    if (!isTeamOwner) return;
    try {
      await updateRoleMutation.mutateAsync({
        id: user.id,
        role: user.role === "admin" ? "member" : "admin",
      });
      toast.success(t("admin.roleUpdated"));
    } catch (error) {
      toast.error(errorMessage(error, t("admin.roleUpdateFailed")));
    }
  };

  const handleSetReader = async (user: AdminUser, days: number) => {
    try {
      await setReaderMutation.mutateAsync({
        id: user.id,
        expiresAt: new Date(
          readerExpiryBase(user) + days * 86_400_000,
        ).toISOString(),
      });
      toast.success(t("admin.readerSet"));
    } catch (error) {
      toast.error(errorMessage(error, t("admin.readerSetFailed")));
    }
  };

  const handleRevokeReader = async (user: AdminUser) => {
    try {
      await revokeReaderMutation.mutateAsync(user.id);
      toast.success(t("admin.readerRevoked"));
    } catch (error) {
      toast.error(errorMessage(error, t("admin.readerRevokeFailed")));
    }
  };

  const handleCopyResetLink = (link: string) => {
    void copyLink(link);
  };

  const allUsers = useMemo(
    () => usersQuery.data?.users ?? [],
    [usersQuery.data?.users],
  );

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return allUsers;
    const q = memberSearch.trim().toLowerCase();
    return allUsers.filter((user) => {
      return (
        user.name?.toLowerCase().includes(q) ||
        user.email?.toLowerCase().includes(q) ||
        user.username?.toLowerCase().includes(q)
      );
    });
  }, [allUsers, memberSearch]);

  return (
    <div className="flex flex-col gap-5">
      <UsersTable
        allUsers={allUsers}
        filteredMembers={filteredMembers}
        handleResetPassword={handleResetPassword}
        handleRevokeReader={handleRevokeReader}
        handleSetReader={handleSetReader}
        handleUpdateRole={handleUpdateRole}
        isTeamAdmin={isTeamAdmin}
        isTeamOwner={isTeamOwner}
        memberSearch={memberSearch}
        meQuery={meQuery}
        setCreateError={setCreateError}
        setCreateOpen={setCreateOpen}
        setCreatedLink={setCreatedLink}
        setDeleteTarget={setDeleteTarget}
        setMemberSearch={setMemberSearch}
        usersQuery={usersQuery}
      />
      <UsersDialogs
        copied={copied}
        createError={createError}
        createOpen={createOpen}
        createdLink={createdLink}
        createUserMutation={createUserMutation}
        deleteTarget={deleteTarget}
        email={email}
        handleCopyResetLink={handleCopyResetLink}
        handleCreateUser={handleCreateUser}
        handleDeleteUser={handleDeleteUser}
        name={name}
        resetLink={resetLink}
        setEmail={setEmail}
        setName={setName}
        setCreateError={setCreateError}
        setCreateOpen={setCreateOpen}
        setCreatedLink={setCreatedLink}
        setDeleteTarget={setDeleteTarget}
        setResetLink={setResetLink}
      />
    </div>
  );
}
