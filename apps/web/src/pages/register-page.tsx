import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  getBootstrapStatus,
  getRegistrationStatus,
  registerAccount,
} from "@/api";
import { authClient } from "@/auth-client";
import { AuthPageFrame, errorMessage } from "@/components/auth-page-frame";
import { CaptchaField } from "@/components/captcha-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

const MIN_PASSWORD_LENGTH = 12;

export function RegisterPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/register" });
  const session = authClient.useSession();
  const bootstrapQuery = useQuery({
    queryKey: ["auth-bootstrap-status"],
    queryFn: getBootstrapStatus,
    retry: false,
  });
  const registrationQuery = useQuery({
    queryKey: ["auth-registration-status"],
    queryFn: getRegistrationStatus,
    retry: false,
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaTicket, setCaptchaTicket] = useState<string | null>(null);
  const [captchaRandstr, setCaptchaRandstr] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  if (session.data?.user) {
    return (
      <Navigate
        replace
        search={{
          q: undefined,
          tag: undefined,
          view: undefined,
          untagged: undefined,
        }}
        to="/"
      />
    );
  }

  const registrationClosed =
    !registrationQuery.isPending &&
    registrationQuery.isSuccess &&
    registrationQuery.data.registration_open === false;

  const handleSubmit = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(t("auth.passwordLength"));
      return;
    }
    if (password !== passwordConfirmation) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }

    const captcha = registrationQuery.data?.captcha;
    if (captcha && captcha.provider !== "none" && !captchaTicket) {
      setFormError(t("auth.captchaRequired"));
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await registerAccount(
        {
          name: name.trim(),
          email: email.trim(),
          password,
        },
        captcha && captcha.provider !== "none" && captchaTicket
          ? { ticket: captchaTicket, randstr: captchaRandstr }
          : undefined,
      );
      setPassword("");
      setPasswordConfirmation("");
      // With a transactional-email provider the account needs verification
      // before it is fully usable; show the check-your-inbox state instead of
      // silently dropping the user at the login form.
      if (registrationQuery.data?.email_verification_required) {
        setRegisteredEmail(email.trim());
        return;
      }
      await navigate({ replace: true, to: "/login" });
    } catch (error) {
      setFormError(errorMessage(error, t("auth.registerFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (registeredEmail) {
    return (
      <AuthPageFrame title={t("auth.verifyEmailTitle")}>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("auth.verifyEmailSent")}{" "}
            <span className="font-medium text-foreground">
              {registeredEmail}
            </span>
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("auth.verifyEmailHint")}
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
    <AuthPageFrame title={t("auth.registerTitle")}>
      {bootstrapQuery.data?.initialized === false && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {t("auth.registrationUnavailable")}
        </p>
      )}
      {registrationClosed && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {t("auth.registrationClosed")}
        </p>
      )}
      {(registrationQuery.isError || bootstrapQuery.isError) && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {t("auth.registrationStatusUnavailable")}
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="register-name"
        >
          {t("auth.displayName")}
          <Input
            autoComplete="name"
            disabled={isSubmitting}
            id="register-name"
            maxLength={80}
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="register-email"
        >
          {t("auth.email")}
          <Input
            autoComplete="email"
            disabled={isSubmitting}
            id="register-email"
            maxLength={320}
            name="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="register-password"
          >
            {t("auth.password")}
            <Input
              autoComplete="new-password"
              disabled={isSubmitting}
              id="register-password"
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="register-password-confirmation"
          >
            {t("auth.confirmPassword")}
            <Input
              autoComplete="new-password"
              disabled={isSubmitting}
              id="register-password-confirmation"
              minLength={MIN_PASSWORD_LENGTH}
              name="password-confirmation"
              required
              type="password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />
          </label>
        </div>
        {registrationQuery.data?.captcha &&
          registrationQuery.data.captcha.provider !== "none" && (
            <CaptchaField
              disabled={isSubmitting}
              onTicket={(ticket, randstr) => {
                setCaptchaTicket(ticket);
                setCaptchaRandstr(randstr);
                setFormError(null);
              }}
              provider={registrationQuery.data.captcha.provider}
              siteKey={registrationQuery.data.captcha.site_key}
            />
          )}
        {formError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button disabled={isSubmitting} type="submit" variant="brand">
          {isSubmitting ? t("auth.registering") : t("auth.signUp")}
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
