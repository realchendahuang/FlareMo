import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getBootstrapStatus } from "@/api";
import { authClient } from "@/auth-client";
import { AuthPageFrame, errorMessage } from "@/components/auth-page-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/login" });
  const session = authClient.useSession();
  const bootstrapQuery = useQuery({
    queryKey: ["auth-bootstrap-status"],
    queryFn: getBootstrapStatus,
    retry: false,
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session.data?.user) {
    return (
      <Navigate
        replace
        search={{ q: undefined, tag: undefined, view: undefined }}
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
      const result = await authClient.signIn.username({
        password,
        username: username.trim(),
      });
      if (result.error) {
        throw result.error;
      }
      setPassword("");
      await navigate({
        replace: true,
        search: { q: undefined, tag: undefined, view: undefined },
        to: "/",
      });
    } catch (error) {
      setFormError(errorMessage(error, t("auth.loginFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageFrame
      description={t("auth.loginDescription")}
      eyebrow={t("auth.nativeAccess")}
      title={t("auth.loginTitle")}
    >
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
          htmlFor="login-username"
        >
          {t("auth.username")}
          <Input
            autoCapitalize="none"
            autoComplete="username"
            disabled={isSubmitting}
            id="login-username"
            maxLength={30}
            name="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
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
      </form>
    </AuthPageFrame>
  );
}
