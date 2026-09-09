import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { getBootstrapStatus, getRegistrationStatus } from "@/api";
import { authClient } from "@/auth-client";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

export function LoginPage() {
  const { t } = useI18n();
  // Preserved by the auth guard when it bounces an unauthenticated visitor;
  // validated same-origin at the route, so this is safe to navigate to after
  // sign-in.
  const { redirect } = useSearch({ from: "/login" });
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session.data?.user) {
    // Single navigation owner: the session render branch decides where to go,
    // so post-sign-in routing never races itself. Ignore redirect values that
    // point back at the login flow (they would recurse).
    if (redirect && !redirect.startsWith("/login")) {
      return <Navigate replace to={redirect} />;
    }
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

  if (
    !bootstrapQuery.isPending &&
    bootstrapQuery.data?.initialized === false &&
    bootstrapQuery.data.setup_available
  ) {
    return <Navigate replace to="/setup" />;
  }

  const handleSubmit = async () => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.email({
        password,
        email: email.trim(),
      });
      if (result.error) {
        throw result.error;
      }
      setPassword("");
    } catch (error) {
      setFormError(errorMessage(error, t("auth.loginFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageFrame title={t("auth.loginTitle")}>
      {bootstrapQuery.isError && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {t("auth.statusUnavailable")}
        </p>
      )}
      {bootstrapQuery.data?.initialized === false &&
        !bootstrapQuery.data.setup_available && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {bootstrapQuery.data.state === "recovery_required"
              ? t("auth.recoveryRequired")
              : t("auth.setupUnavailable")}
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
          htmlFor="login-email"
        >
          {t("auth.email")}
          <Input
            autoCapitalize="none"
            autoComplete="email"
            disabled={isSubmitting}
            id="login-email"
            maxLength={320}
            name="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="login-password"
        >
          {t("auth.password")}
          <Input
            autoComplete="current-password"
            disabled={isSubmitting}
            id="login-password"
            minLength={12}
            name="password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {formError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button
          className="mt-1"
          disabled={isSubmitting}
          type="submit"
          variant="brand"
        >
          {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
        </Button>
        <p className="text-center text-sm">
          <Link
            className="text-muted-foreground underline-offset-4 hover:underline"
            to="/forgot-password"
          >
            {t("auth.forgotPasswordHint")}
          </Link>
        </p>
        {registrationQuery.data?.registration_open && (
          <p className="text-center text-sm">
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to="/register"
            >
              {t("auth.registerLink")}
            </Link>
          </p>
        )}
      </form>
    </AuthPageFrame>
  );
}
