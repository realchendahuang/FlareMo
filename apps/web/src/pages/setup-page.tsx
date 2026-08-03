import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { bootstrapOwner, getBootstrapStatus } from "@/api";
import { AuthPageFrame, errorMessage } from "@/components/auth-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

const MIN_PASSWORD_LENGTH = 12;

export function SetupPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/setup" });
  const queryClient = useQueryClient();
  const bootstrapQuery = useQuery({
    queryKey: ["auth-bootstrap-status"],
    queryFn: getBootstrapStatus,
    retry: false,
  });
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (bootstrapQuery.data?.initialized) {
    return <Navigate replace to="/login" />;
  }

  const handleSubmit = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(t("auth.passwordLength"));
      return;
    }
    if (password !== passwordConfirmation) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await bootstrapOwner({
        bootstrapSecret,
        email: email.trim(),
        name: name.trim(),
        password,
        username: username.trim(),
      });
      setBootstrapSecret("");
      setPassword("");
      setPasswordConfirmation("");
      await queryClient.invalidateQueries({
        queryKey: ["auth-bootstrap-status"],
      });
      await navigate({ replace: true, to: "/login" });
    } catch (error) {
      setFormError(errorMessage(error, t("auth.setupFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const setupAvailable = bootstrapQuery.data?.setup_available === true;

  return (
    <AuthPageFrame
      description={t("auth.setupDescription")}
      eyebrow={t("auth.oneTimeSetup")}
      title={t("auth.setupTitle")}
    >
      {bootstrapQuery.isPending && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}
      {bootstrapQuery.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {t("auth.statusUnavailable")}
        </p>
      )}
      {!bootstrapQuery.isPending &&
        !bootstrapQuery.isError &&
        !setupAvailable && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {bootstrapQuery.data?.state === "recovery_required"
              ? t("auth.recoveryRequired")
              : t("auth.setupUnavailable")}
          </p>
        )}
      {setupAvailable && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            {t("auth.setupSecretNotice")}
          </p>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="setup-bootstrap-secret"
          >
            {t("auth.bootstrapSecret")}
            <Input
              autoComplete="off"
              disabled={isSubmitting}
              id="setup-bootstrap-secret"
              name="bootstrap-secret"
              required
              type="password"
              value={bootstrapSecret}
              onChange={(event) => setBootstrapSecret(event.target.value)}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="setup-username"
            >
              {t("auth.username")}
              <Input
                autoCapitalize="none"
                autoComplete="username"
                disabled={isSubmitting}
                id="setup-username"
                maxLength={30}
                minLength={3}
                name="username"
                pattern="[A-Za-z0-9_]+"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="setup-name"
            >
              {t("auth.displayName")}
              <Input
                autoComplete="name"
                disabled={isSubmitting}
                id="setup-name"
                maxLength={80}
                name="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <label
            className="flex flex-col gap-1.5 text-sm font-medium"
            htmlFor="setup-email"
          >
            {t("auth.email")}
            <Input
              autoComplete="email"
              disabled={isSubmitting}
              id="setup-email"
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
              htmlFor="setup-password"
            >
              {t("auth.password")}
              <Input
                autoComplete="new-password"
                disabled={isSubmitting}
                id="setup-password"
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
              htmlFor="setup-password-confirmation"
            >
              {t("auth.confirmPassword")}
              <Input
                autoComplete="new-password"
                disabled={isSubmitting}
                id="setup-password-confirmation"
                minLength={MIN_PASSWORD_LENGTH}
                name="password-confirmation"
                required
                type="password"
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
              />
            </label>
          </div>
          {formError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
          <Button disabled={isSubmitting} type="submit" variant="brand">
            {isSubmitting ? t("auth.settingUp") : t("auth.completeSetup")}
          </Button>
        </form>
      )}
    </AuthPageFrame>
  );
}
