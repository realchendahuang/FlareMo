import { RefreshCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TranslationKey } from "@/i18n";

export const MIN_PASSWORD_LENGTH = 12;

type SecurityPanelProps = {
  changeEmailIsPending: boolean;
  changePasswordIsPending: boolean;
  currentEmail: string;
  currentPassword: string;
  deleteAccountIsPending: boolean;
  deleteError: string | null;
  deletePassword: string;
  emailCurrentPassword: string;
  emailError: string | null;
  emailVerificationPending: boolean;
  isOwner: boolean;
  newPassword: string;
  newPasswordConfirmation: string;
  passwordError: string | null;
  setCurrentPassword: (value: string) => void;
  setDeletePassword: (value: string) => void;
  setEmailCurrentPassword: (value: string) => void;
  setNewEmail: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirmation: (value: string) => void;
  t: (key: TranslationKey) => string;
  newEmail: string;
  onEmailSubmit: () => Promise<void>;
  onPasswordSubmit: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
};

/** Closes a dialog only after a submit succeeds: pending -> idle with no error. */
function useCloseOnSuccess(
  isPending: boolean,
  hasError: boolean,
  close: () => void,
) {
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !hasError) close();
    wasPending.current = isPending;
  }, [isPending, hasError, close]);
}

export function SecurityPanel({
  changeEmailIsPending,
  changePasswordIsPending,
  currentEmail,
  currentPassword,
  deleteAccountIsPending,
  deleteError,
  deletePassword,
  emailCurrentPassword,
  emailError,
  emailVerificationPending,
  isOwner,
  newPassword,
  newPasswordConfirmation,
  passwordError,
  setCurrentPassword,
  setDeletePassword,
  setEmailCurrentPassword,
  setNewEmail,
  setNewPassword,
  setNewPasswordConfirmation,
  t,
  newEmail,
  onEmailSubmit,
  onPasswordSubmit,
  onDeleteAccount,
}: SecurityPanelProps) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useCloseOnSuccess(changePasswordIsPending, passwordError !== null, () =>
    setPasswordOpen(false),
  );
  useCloseOnSuccess(changeEmailIsPending, emailError !== null, () =>
    setEmailOpen(false),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.passwordTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-end gap-3">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => setPasswordOpen(true)}
          >
            <RefreshCcwIcon data-icon="inline-start" />
            {t("auth.changePassword")}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.emailTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm">{currentEmail}</p>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setEmailOpen(true)}
            >
              <RefreshCcwIcon data-icon="inline-start" />
              {t("auth.changeEmail")}
            </Button>
          </div>
          {emailVerificationPending && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              {t("auth.emailChangeVerificationSent")}
            </p>
          )}
        </CardContent>
      </Card>
      {!isOwner && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>{t("auth.deleteAccountTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              {t("auth.deleteAccountSubmit")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.passwordTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onPasswordSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-current-password"
            >
              {t("auth.currentPassword")}
              <Input
                autoComplete="current-password"
                disabled={changePasswordIsPending}
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
                disabled={changePasswordIsPending}
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
                disabled={changePasswordIsPending}
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
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {passwordError}
              </p>
            )}
            <DialogFooter>
              <Button
                disabled={changePasswordIsPending}
                type="button"
                variant="outline"
                onClick={() => setPasswordOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={changePasswordIsPending} type="submit">
                {changePasswordIsPending && (
                  <RefreshCcwIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                {changePasswordIsPending ? t("auth.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.emailTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onEmailSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-new-email"
            >
              {t("auth.newEmail")}
              <Input
                autoCapitalize="none"
                autoComplete="email"
                disabled={changeEmailIsPending}
                id="account-new-email"
                required
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-email-current-password"
            >
              {t("auth.currentPassword")}
              <Input
                autoComplete="current-password"
                disabled={changeEmailIsPending}
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
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {emailError}
              </p>
            )}
            <DialogFooter>
              <Button
                disabled={changeEmailIsPending}
                type="button"
                variant="outline"
                onClick={() => setEmailOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={changeEmailIsPending} type="submit">
                {changeEmailIsPending && (
                  <RefreshCcwIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                {changeEmailIsPending ? t("auth.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.deleteAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("auth.deleteAccountDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onDeleteAccount();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-delete-password"
            >
              {t("auth.deleteAccountPassword")}
              <Input
                autoComplete="current-password"
                disabled={deleteAccountIsPending}
                id="account-delete-password"
                required
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            {deleteError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAccountIsPending}>
                {t("common.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteAccountIsPending || deletePassword.length === 0}
                onClick={(event) => {
                  event.preventDefault();
                  void onDeleteAccount();
                }}
              >
                {deleteAccountIsPending
                  ? t("auth.deleteAccountSubmitting")
                  : t("auth.deleteAccountSubmit")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
