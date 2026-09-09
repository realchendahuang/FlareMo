import { RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TranslationKey } from "@/i18n";

export const MIN_PASSWORD_LENGTH = 12;

type SecurityPanelProps = {
  changeEmailIsPending: boolean;
  changePasswordIsPending: boolean;
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

export function SecurityPanel({
  changeEmailIsPending,
  changePasswordIsPending,
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
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.passwordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onPasswordSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2"
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
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive sm:col-span-2">
                {passwordError}
              </p>
            )}
            <div className="sm:col-span-2">
              <Button disabled={changePasswordIsPending} type="submit">
                <RefreshCcwIcon data-icon="inline-start" />
                {changePasswordIsPending
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
              void onEmailSubmit();
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
                disabled={changeEmailIsPending}
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
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive sm:col-span-2">
                {emailError}
              </p>
            )}
            <div className="sm:col-span-2">
              <Button disabled={changeEmailIsPending} type="submit">
                <RefreshCcwIcon data-icon="inline-start" />
                {changeEmailIsPending
                  ? t("auth.saving")
                  : t("auth.changeEmail")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {!isOwner && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>{t("auth.deleteAccountTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onDeleteAccount();
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
              <Button
                className="w-fit"
                disabled={deleteAccountIsPending || deletePassword.length === 0}
                type="submit"
                variant="destructive"
              >
                {deleteAccountIsPending
                  ? t("auth.deleteAccountSubmitting")
                  : t("auth.deleteAccountSubmit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
