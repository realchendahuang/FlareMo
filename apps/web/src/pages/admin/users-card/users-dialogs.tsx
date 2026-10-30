import type { AdminUser } from "@/api";
import { InfoTip } from "@/components/info-tip";
import { SecretRevealDialog } from "@/components/secret-reveal-dialog";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";

/**
 * The modal half of the former users-card.tsx AdminPanel: the delete
 * confirm, the create-user form, and the two one-time secret reveals
 * (activation link / reset link). JSX is moved verbatim; state and handlers
 * stay in users-card.tsx and flow in through props.
 */

function DeleteUserDialog({
  deleteTarget,
  handleDeleteUser,
  setDeleteTarget,
}: {
  deleteTarget: AdminUser | null;
  handleDeleteUser: (user: AdminUser) => Promise<void>;
  setDeleteTarget: (user: AdminUser | null) => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.deleteUser")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.deleteConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (deleteTarget) void handleDeleteUser(deleteTarget);
            }}
          >
            {t("admin.deleteUser")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateUserDialog({
  createError,
  createOpen,
  createUserMutation,
  email,
  handleCreateUser,
  name,
  setEmail,
  setName,
  setCreateOpen,
}: {
  createError: string | null;
  createOpen: boolean;
  createUserMutation: { isPending: boolean };
  email: string;
  handleCreateUser: () => Promise<void>;
  name: string;
  setEmail: (email: string) => void;
  setName: (name: string) => void;
  setCreateOpen: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.createUser")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateUser();
          }}
        >
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="admin-name"
          >
            {t("auth.displayName")}
            <Input
              autoFocus
              autoComplete="off"
              disabled={createUserMutation.isPending}
              id="admin-name"
              maxLength={80}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="admin-email"
          >
            {t("auth.email")}
            <Input
              autoComplete="off"
              disabled={createUserMutation.isPending}
              id="admin-email"
              maxLength={320}
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className="flex items-center gap-1 text-xs leading-5 text-muted-foreground">
            <InfoTip text={t("admin.activationDescription")} />
            <span className="sr-only">{t("admin.activationDescription")}</span>
          </p>
          {createError && <Alert variant="destructive">{createError}</Alert>}
          <DialogFooter>
            <Button
              disabled={createUserMutation.isPending}
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={createUserMutation.isPending} type="submit">
              {createUserMutation.isPending && (
                <Spinner data-icon="inline-start" />
              )}
              {createUserMutation.isPending
                ? t("admin.creatingUser")
                : t("admin.createUser")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatedLinkDialog({
  copied,
  createdLink,
  handleCopyResetLink,
  setCreatedLink,
}: {
  copied: boolean;
  createdLink: string | null;
  handleCopyResetLink: (link: string) => void;
  setCreatedLink: (link: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <SecretRevealDialog
      closeLabelKey="common.close"
      copied={copied}
      copyLabelKey="admin.copyResetLink"
      description={t("admin.activationDescription")}
      onCopy={() => {
        if (createdLink) void handleCopyResetLink(createdLink);
      }}
      onOpenChange={(open) => {
        if (!open) setCreatedLink(null);
      }}
      open={createdLink !== null}
      t={t}
      titleKey="admin.userCreatedTitle"
      value={createdLink ?? ""}
    />
  );
}

function ResetLinkDialog({
  copied,
  handleCopyResetLink,
  resetLink,
  setResetLink,
}: {
  copied: boolean;
  handleCopyResetLink: (link: string) => void;
  resetLink: string | null;
  setResetLink: (link: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <SecretRevealDialog
      closeLabelKey="admin.hideResetLink"
      copied={copied}
      copyLabelKey="admin.copyResetLink"
      description={t("admin.resetLinkDescription")}
      onCopy={() => {
        if (resetLink) void handleCopyResetLink(resetLink);
      }}
      onOpenChange={(open) => {
        if (!open) setResetLink(null);
      }}
      open={resetLink !== null}
      t={t}
      titleKey="admin.resetLinkTitle"
      value={resetLink ?? ""}
    />
  );
}

export function UsersDialogs(props: {
  copied: boolean;
  createError: string | null;
  createOpen: boolean;
  createdLink: string | null;
  resetLink: string | null;
  deleteTarget: AdminUser | null;
  handleCopyResetLink: (link: string) => void;
  handleCreateUser: () => Promise<void>;
  handleDeleteUser: (user: AdminUser) => Promise<void>;
  setCreateError: (error: string | null) => void;
  setCreateOpen: (open: boolean) => void;
  setCreatedLink: (link: string | null) => void;
  setEmail: (email: string) => void;
  setName: (name: string) => void;
  setDeleteTarget: (user: AdminUser | null) => void;
  setResetLink: (link: string | null) => void;
  createUserMutation: { isPending: boolean };
  email: string;
  name: string;
}) {
  return (
    <>
      <DeleteUserDialog
        deleteTarget={props.deleteTarget}
        handleDeleteUser={props.handleDeleteUser}
        setDeleteTarget={props.setDeleteTarget}
      />
      <CreateUserDialog
        createError={props.createError}
        createOpen={props.createOpen}
        createUserMutation={props.createUserMutation}
        email={props.email}
        handleCreateUser={props.handleCreateUser}
        name={props.name}
        setEmail={props.setEmail}
        setName={props.setName}
        setCreateOpen={props.setCreateOpen}
      />
      <CreatedLinkDialog
        copied={props.copied}
        createdLink={props.createdLink}
        handleCopyResetLink={props.handleCopyResetLink}
        setCreatedLink={props.setCreatedLink}
      />
      <ResetLinkDialog
        copied={props.copied}
        handleCopyResetLink={props.handleCopyResetLink}
        resetLink={props.resetLink}
        setResetLink={props.setResetLink}
      />
    </>
  );
}
