import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  getBootstrapStatus,
  getRegistrationStatus,
  registerAccount,
  resendVerificationEmail,
} from "@/api";
import { authClient } from "@/auth-client";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { CaptchaField } from "@/components/captcha-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

const MIN_PASSWORD_LENGTH = 8;

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
  const [resent, setResent] = useState(false);
  const resendMutation = useMutation({
    mutationFn: resendVerificationEmail,
    onSuccess: () => setResent(true),
  });

  if (session.data?.user) {
    return (
      <Navigate
        replace
        search={{
          q: undefined,
          tag: undefined,
          view: undefined,
          space: undefined,
          untagged: undefined,
          compose: undefined,
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
          {resent ? (
            <p className="text-sm leading-6 text-success-emphasis">
              {t("auth.resendVerificationSent")}
            </p>
          ) : (
            <Button
              disabled={resendMutation.isPending || !registeredEmail}
              onClick={() =>
                registeredEmail &&
                void resendMutation.mutateAsync(registeredEmail)
              }
              variant="outline"
            >
              {resendMutation.isPending
                ? t("auth.resendVerificationSending")
                : t("auth.resendVerification")}
            </Button>
          )}
          <Link
            className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      </AuthPageFrame>
    );
  }

  // Closed or not-yet-bootstrapped: a form that can only fail is noise, so
  // show the reason and the way back instead.
  const unavailable =
    registrationClosed || bootstrapQuery.data?.initialized === false;
  if (unavailable) {
    return (
      <AuthPageFrame title={t("auth.registerTitle")}>
        <div className="flex flex-col gap-4" role="status">
          <p className="text-sm leading-6 text-muted-foreground">
            {registrationClosed
              ? t("auth.registrationClosed")
              : t("auth.registrationUnavailable")}
          </p>
          <Button render={<Link to="/login" />} variant="outline">
            {t("auth.signIn")}
          </Button>
        </div>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame title={t("auth.registerTitle")}>
      {bootstrapQuery.data?.initialized === false && (
        <Alert className="mb-4" role="status" variant="warning">
          {t("auth.registrationUnavailable")}
        </Alert>
      )}
      {registrationClosed && (
        <Alert className="mb-4" role="status" variant="warning">
          {t("auth.registrationClosed")}
        </Alert>
      )}
      {(registrationQuery.isError || bootstrapQuery.isError) && (
        <Alert className="mb-4" variant="destructive">
          {t("auth.registrationStatusUnavailable")}
        </Alert>
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
            <PasswordInput
              autoComplete="new-password"
              disabled={isSubmitting}
              id="register-password"
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="register-password-confirmation"
          >
            {t("auth.confirmPassword")}
            <PasswordInput
              autoComplete="new-password"
              disabled={isSubmitting}
              id="register-password-confirmation"
              minLength={MIN_PASSWORD_LENGTH}
              name="password-confirmation"
              required
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />
          </label>
        </div>
        {registrationQuery.isPending ? (
          // Reserve the captcha's button height while the status is in
          // flight so the submit button doesn't pop down when it lands.
          <div aria-hidden="true" className="min-h-9" />
        ) : (
          registrationQuery.data?.captcha &&
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
          )
        )}
        {formError && <Alert variant="destructive">{formError}</Alert>}
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
