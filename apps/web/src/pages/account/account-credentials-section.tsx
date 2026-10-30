import { KeyRoundIcon, MailIcon, RefreshCcwIcon } from "lucide-react";
import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
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
import { PasswordInput } from "@/components/ui/password-input";
import type { TranslationKey, TranslationParams } from "@/i18n";
import {
  MIN_PASSWORD_LENGTH,
  useCloseOnSuccess,
} from "./account-panel-presets";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

/**
 * The account group's email and password rows with their dialogs. Like the
 * profile section it renders only the rows — the panel keeps the group's card
 * around both halves.
 */
type AccountCredentialsSectionProps = {
  changeEmailIsPending: boolean;
  currentEmail: string;
  emailProviderDisabled?: boolean;
  emailCurrentPassword: string;
  emailError: string | null;
  emailVerificationPending: boolean;
  newEmail: string;
  setEmailCurrentPassword: (value: string) => void;
  setNewEmail: (value: string) => void;
  onEmailSubmit: () => Promise<void>;

  changePasswordIsPending: boolean;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  passwordError: string | null;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirmation: (value: string) => void;
  onPasswordSubmit: () => Promise<void>;

  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function AccountCredentialsSection({
  changeEmailIsPending,
  currentEmail,
  emailProviderDisabled,
  emailCurrentPassword,
  emailError,
  emailVerificationPending,
  newEmail,
  setEmailCurrentPassword,
  setNewEmail,
  onEmailSubmit,

  changePasswordIsPending,
  currentPassword,
  newPassword,
  newPasswordConfirmation,
  passwordError,
  setCurrentPassword,
  setNewPassword,
  setNewPasswordConfirmation,
  onPasswordSubmit,

  t,
}: AccountCredentialsSectionProps) {
  // Dialog visibility states
  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  // Auto-close dialogs on mutation success
  useCloseOnSuccess(changeEmailIsPending, emailError !== null, () =>
    setEmailOpen(false),
  );
  useCloseOnSuccess(changePasswordIsPending, passwordError !== null, () =>
    setPasswordOpen(false),
  );

  return (
    <>
      <SettingsRow
        icon={MailIcon}
        label={
          <div className="flex items-center gap-1.5">
            <span>{t("auth.emailTitle")}</span>
            {emailProviderDisabled && (
              <InfoTip text={t("auth.noEmailProviderNote")} />
            )}
          </div>
        }
        description={
          emailVerificationPending
            ? t("auth.emailChangeVerificationSent")
            : undefined
        }
        value={currentEmail || "—"}
        chevron
        onClick={() => setEmailOpen(true)}
      />
      <SettingsRow
        icon={KeyRoundIcon}
        label={t("auth.passwordTitle")}
        value="••••••••"
        chevron
        onClick={() => setPasswordOpen(true)}
      />

      {/* Email Change Dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.emailTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onEmailSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-email-password"
            >
              {t("auth.currentPassword")}
              <PasswordInput
                autoComplete="current-password"
                disabled={changeEmailIsPending}
                id="account-email-password"
                required
                value={emailCurrentPassword}
                onChange={(event) =>
                  setEmailCurrentPassword(event.target.value)
                }
              />
            </label>
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
            {emailError && <Alert variant="destructive">{emailError}</Alert>}
            <DialogFooter className="mt-2">
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
                {t("auth.changeEmail")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Change Dialog */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.passwordTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
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
              <PasswordInput
                autoComplete="current-password"
                disabled={changePasswordIsPending}
                id="account-current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-new-password"
            >
              {t("auth.newPassword")}
              <PasswordInput
                autoComplete="new-password"
                disabled={changePasswordIsPending}
                id="account-new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-password-confirmation"
            >
              {t("auth.confirmPassword")}
              <PasswordInput
                autoComplete="new-password"
                disabled={changePasswordIsPending}
                id="account-password-confirmation"
                minLength={MIN_PASSWORD_LENGTH}
                required
                value={newPasswordConfirmation}
                onChange={(event) =>
                  setNewPasswordConfirmation(event.target.value)
                }
              />
            </label>
            {passwordError && (
              <Alert variant="destructive">{passwordError}</Alert>
            )}
            <DialogFooter className="mt-2">
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
                {t("auth.changePassword")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The non-owner danger zone: a group of its own next to the account and token
 * groups, plus the delete confirmation it opens.
 */
type DeleteAccountSectionProps = {
  deleteAccountIsPending: boolean;
  deleteError: string | null;
  deletePassword: string;
  setDeletePassword: (value: string) => void;
  onDeleteAccount: () => Promise<boolean>;

  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function DeleteAccountSection({
  deleteAccountIsPending,
  deleteError,
  deletePassword,
  setDeletePassword,
  onDeleteAccount,

  t,
}: DeleteAccountSectionProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <SettingsSectionGroup title={t("common.actions")}>
        <SettingsRow
          destructive
          label={t("auth.deleteAccountTitle")}
          onClick={() => setDeleteOpen(true)}
        />
      </SettingsSectionGroup>

      {/* Delete Account Alert Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.deleteAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("auth.deleteAccountDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="delete-account-password"
            >
              {t("auth.deleteAccountPassword")}
              <PasswordInput
                autoComplete="current-password"
                disabled={deleteAccountIsPending}
                id="delete-account-password"
                required
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            {deleteError && <Alert variant="destructive">{deleteError}</Alert>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteAccountIsPending}
              variant="ghost"
              onClick={() => {
                setDeletePassword("");
              }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteAccountIsPending || !deletePassword}
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void onDeleteAccount().then((deleted) => {
                  if (deleted) setDeleteOpen(false);
                });
              }}
            >
              {deleteAccountIsPending && (
                <RefreshCcwIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              )}
              {t("auth.deleteAccountSubmit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
