import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { getRegistrationStatus, requestPasswordReset } from "@/api";
import { AuthPageFrame, errorMessage } from "@/components/auth-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The registration status is public and doubles as the deployment's
  // "transactional email configured" signal: without an email provider the
  // only reset path is the self-hosted recovery-key flow.
  const statusQuery = useQuery({
    queryKey: ["register-status"],
    queryFn: getRegistrationStatus,
    retry: false,
  });
  const emailProviderEnabled =
    statusQuery.data?.email_verification_required === true;

  const handleSubmit = async () => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error, t("auth.forgotPasswordFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthPageFrame title={t("auth.forgotPasswordTitle")}>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("auth.forgotPasswordSent")}
          </p>
          <Link
            className="text-sm font-medium text-flame-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame
      description={t("auth.forgotPasswordDescription")}
      title={t("auth.forgotPasswordTitle")}
    >
      {!emailProviderEnabled && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {t("auth.forgotPasswordSelfHostHint")}{" "}
          <Link className="underline underline-offset-4" to="/recover">
            {t("auth.forgotPasswordRecoverLink")}
          </Link>
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!emailProviderEnabled) return;
          void handleSubmit();
        }}
      >
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="forgot-password-email"
        >
          {t("auth.email")}
          <Input
            autoComplete="email"
            disabled={isSubmitting || !emailProviderEnabled}
            id="forgot-password-email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {formError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button
          disabled={isSubmitting || !emailProviderEnabled}
          type="submit"
          variant="brand"
        >
          {isSubmitting
            ? t("auth.forgotPasswordSending")
            : t("auth.forgotPasswordSubmit")}
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
