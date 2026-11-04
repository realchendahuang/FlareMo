import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { bootstrapOwner, getBootstrapStatus } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const MIN_PASSWORD_LENGTH = 8;

export function SetupPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/setup" });
  const queryClient = useQueryClient();
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.authBootstrapStatus,
    queryFn: getBootstrapStatus,
    retry: false,
  });
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
      });
      setBootstrapSecret("");
      setPassword("");
      setPasswordConfirmation("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.authBootstrapStatus,
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
        // Form-shaped skeleton instead of a one-line "loading": the real
        // content is a ~4-row form, so matching its silhouette keeps the
        // single swap from skeleton to form visually quiet.
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-28" />
        </div>
      )}
      {bootstrapQuery.isError && (
        <Alert variant="destructive">{t("auth.statusUnavailable")}</Alert>
      )}
      {!bootstrapQuery.isPending &&
        !bootstrapQuery.isError &&
        !setupAvailable && (
          <Alert role="status" variant="warning">
            {bootstrapQuery.data?.state === "recovery_required"
              ? t("auth.recoveryRequired")
              : t("auth.setupUnavailable")}
          </Alert>
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
            />{" "}
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
              <PasswordInput
                autoComplete="new-password"
                disabled={isSubmitting}
                id="setup-password"
                minLength={MIN_PASSWORD_LENGTH}
                name="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="setup-password-confirmation"
            >
              {t("auth.confirmPassword")}
              <PasswordInput
                autoComplete="new-password"
                disabled={isSubmitting}
                id="setup-password-confirmation"
                minLength={MIN_PASSWORD_LENGTH}
                name="password-confirmation"
                required
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
              />
            </label>
          </div>
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <Button disabled={isSubmitting} type="submit" variant="brand">
            {isSubmitting ? t("auth.settingUp") : t("auth.completeSetup")}
          </Button>
        </form>
      )}
    </AuthPageFrame>
  );
}
