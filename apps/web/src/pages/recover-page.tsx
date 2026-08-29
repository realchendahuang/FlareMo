import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { recoverOwner } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

const MIN_PASSWORD_LENGTH = 12;

export function RecoverPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/recover" });
  const [recoverySecret, setRecoverySecret] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFormError(t("auth.passwordLength"));
      return;
    }
    if (newPassword !== confirmation) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await recoverOwner({
        recoverySecret: recoverySecret.trim(),
        newPassword,
      });
      setDone(true);
    } catch (error) {
      setFormError(errorMessage(error, t("recover.failed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthPageFrame title={t("recover.title")}>
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {t("recover.success")}
        </p>
        <Button
          className="mt-4 w-full"
          variant="brand"
          onClick={() => void navigate({ replace: true, to: "/login" })}
        >
          {t("auth.signIn")}
        </Button>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame
      description={t("recover.description")}
      title={t("recover.title")}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="recover-secret"
        >
          {t("recover.secret")}
          <Input
            autoComplete="off"
            disabled={isSubmitting}
            id="recover-secret"
            required
            type="password"
            value={recoverySecret}
            onChange={(event) => setRecoverySecret(event.target.value)}
          />
        </label>
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="recover-new-password"
        >
          {t("auth.newPassword")}
          <Input
            autoComplete="new-password"
            disabled={isSubmitting}
            id="recover-new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="recover-confirmation"
        >
          {t("auth.confirmPassword")}
          <Input
            autoComplete="new-password"
            disabled={isSubmitting}
            id="recover-confirmation"
            minLength={MIN_PASSWORD_LENGTH}
            required
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {formError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button disabled={isSubmitting} type="submit" variant="brand">
          {isSubmitting ? t("recover.submitting") : t("recover.submit")}
        </Button>
      </form>
    </AuthPageFrame>
  );
}
