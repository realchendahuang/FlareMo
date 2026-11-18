import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { resetPassword } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import {
  MIN_PASSWORD_LENGTH,
  NewPasswordFields,
} from "@/components/new-password-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

export function ResetPage({ token }: { token: string | undefined }) {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/reset" });
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (!token) {
      setFormError(t("reset.missingToken"));
      return;
    }
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
      await resetPassword({ token, newPassword });
      setDone(true);
    } catch (error) {
      setFormError(errorMessage(error, t("reset.failed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthPageFrame title={t("reset.title")}>
        <Alert role="status" variant="success">
          {t("reset.success")}
        </Alert>
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
      description={t("reset.description")}
      title={t("reset.title")}
    >
      {!token && (
        <Alert className="mb-4" variant="destructive">
          {t("reset.missingToken")}
        </Alert>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <NewPasswordFields
          confirmation={confirmation}
          disabled={isSubmitting}
          idPrefix="reset"
          newPassword={newPassword}
          onConfirmationChange={setConfirmation}
          onNewPasswordChange={setNewPassword}
        />
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <Button disabled={isSubmitting || !token} type="submit" variant="brand">
          {isSubmitting ? t("reset.submitting") : t("reset.submit")}
        </Button>
        <p className="text-center text-sm">
          <Link
            className="text-muted-foreground underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </p>
      </form>
    </AuthPageFrame>
  );
}
