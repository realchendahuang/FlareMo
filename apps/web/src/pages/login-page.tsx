import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getBootstrapStatus, getRegistrationStatus } from "@/api";
import { getAuthProviders } from "@/api/integrations";
import { authClient } from "@/auth-client";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

// How long the login page waits for the client session to confirm a
// successful sign-in before falling back to a full document navigation. The
// sign-in response has already stored the session cookie, so a reload reads
// it directly; without this fallback a stalled confirmation left the user on
// the form with no feedback (2026-10-10 support report: three successful
// sign-ins, browser never left the login page).
const POST_SIGN_IN_CONFIRMATION_TIMEOUT_MS = 5_000;
// Marker for the recovery reload above: if the tab comes back to the login
// page still without a session, the browser did not keep the cookie, and
// reloading again would only loop. The timestamp keeps a stale marker from a
// much later visit from raising a false alarm.
const POST_SIGN_IN_RECOVERY_KEY = "flaremo.post-signin-recovery";
const POST_SIGN_IN_RECOVERY_TTL_MS = 120_000;

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
  const providersQuery = useQuery({
    queryKey: ["auth-providers"],
    queryFn: getAuthProviders,
    staleTime: 60_000,
  });
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialPending, setSocialPending] = useState<string | null>(null);
  const [postSignIn, setPostSignIn] = useState(false);

  // After a successful sign-in the server has already set the session
  // cookie; the render branch below navigates as soon as the client session
  // lands. That confirmation is a second round trip — when it stalls,
  // nothing else moves the user off the form, so this watchdog guarantees an
  // exit: with the cookie in place a full navigation reads it directly.
  useEffect(() => {
    if (!postSignIn) return;
    const target = redirect && !redirect.startsWith("/login") ? redirect : "/";
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(POST_SIGN_IN_RECOVERY_KEY, String(Date.now()));
      } catch {
        // Storage unavailable; the reload below is still the right recovery.
      }
      window.location.replace(target);
    }, POST_SIGN_IN_CONFIRMATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [postSignIn, redirect]);

  // Returning from the recovery reload still without a session means the
  // browser refused the session cookie (blocked by privacy settings); a
  // further reload cannot help, so surface it instead of looping silently.
  useEffect(() => {
    if (session.isPending) return;
    let marker: string | null = null;
    try {
      marker = sessionStorage.getItem(POST_SIGN_IN_RECOVERY_KEY);
      if (marker) sessionStorage.removeItem(POST_SIGN_IN_RECOVERY_KEY);
    } catch {
      return;
    }
    if (!marker || session.data?.user) return;
    if (Date.now() - Number(marker) > POST_SIGN_IN_RECOVERY_TTL_MS) return;
    setFormError(t("auth.sessionNotStored"));
  }, [session.data, session.isPending, t]);

  const socialProviders = [
    ...(providersQuery.data?.google ? ["google"] : []),
    ...(providersQuery.data?.github ? ["github"] : []),
  ];

  const handleSocialSignIn = async (provider: "google" | "github") => {
    setFormError(null);
    setSocialPending(provider);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL:
          redirect && !redirect.startsWith("/login") ? redirect : "/",
      });
      if (result.error) {
        throw result.error;
      }
      // The server returns the provider's authorization URL; complete the
      // round trip in this tab.
      if (result.data?.url) {
        window.location.href = result.data.url;
        return;
      }
      setSocialPending(null);
    } catch (error) {
      setSocialPending(null);
      setFormError(errorMessage(error, t("auth.loginFailed")));
    }
  };

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
          space: undefined,
          untagged: undefined,
          compose: undefined,
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
    const trimmed = account.trim();
    const isExplicitHandle = trimmed.startsWith("@");
    const isEmail =
      !isExplicitHandle && trimmed.includes("@") && trimmed.includes(".");

    try {
      if (isEmail) {
        const result = await authClient.signIn.email({
          password,
          email: trimmed,
        });
        if (result.error) {
          throw result.error;
        }
      } else {
        const username = trimmed.replace(/^@/, "");
        const result = await authClient.signIn.username({
          password,
          username,
        });
        if (result.error) {
          throw result.error;
        }
      }
      setPassword("");
      // Keep the form disabled: the session render branch (or the watchdog
      // above) owns navigation from here.
      setPostSignIn(true);
    } catch (error) {
      setFormError(errorMessage(error, t("auth.loginFailed")));
      setIsSubmitting(false);
    }
  };

  let submitLabel = t("auth.signIn");
  if (isSubmitting) {
    submitLabel = postSignIn
      ? t("auth.confirmingSession")
      : t("auth.signingIn");
  }

  return (
    <AuthPageFrame title={t("auth.loginTitle")}>
      {bootstrapQuery.isError && (
        <Alert className="mb-4" variant="destructive">
          {t("auth.statusUnavailable")}
        </Alert>
      )}
      {bootstrapQuery.data?.initialized === false &&
        !bootstrapQuery.data.setup_available && (
          <Alert className="mb-4" role="status" variant="warning">
            {bootstrapQuery.data.state === "recovery_required"
              ? t("auth.recoveryRequired")
              : t("auth.setupUnavailable")}
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
          htmlFor="login-account"
        >
          {t("auth.emailOrUsername")}
          <Input
            autoCapitalize="none"
            autoComplete="username"
            disabled={isSubmitting}
            id="login-account"
            maxLength={320}
            name="account"
            placeholder={t("auth.emailOrUsernamePlaceholder")}
            required
            type="text"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </label>
        <label
          className="flex flex-col gap-1.5 text-sm font-medium"
          htmlFor="login-password"
        >
          {t("auth.password")}
          <PasswordInput
            autoComplete="current-password"
            disabled={isSubmitting}
            id="login-password"
            name="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <Button
          className="mt-1"
          disabled={isSubmitting}
          type="submit"
          variant="brand"
        >
          {submitLabel}
        </Button>
        {socialProviders.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-center text-muted-foreground text-xs">
              {t("auth.socialSignInHint")}
            </p>
            {socialProviders.map((provider) => (
              <Button
                disabled={socialPending !== null || isSubmitting}
                key={provider}
                type="button"
                variant="outline"
                onClick={() =>
                  void handleSocialSignIn(provider as "google" | "github")
                }
              >
                {socialPending === provider && (
                  <Spinner data-icon="inline-start" />
                )}
                {provider === "google"
                  ? t("auth.continueWithGoogle")
                  : t("auth.continueWithGithub")}
              </Button>
            ))}
          </div>
        )}
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
        {/* Always-present trailing slot: the register link appears here once
            the public status lands, and the row keeps its height so the
            buttons above never shift. */}
        <div aria-hidden="true" className="min-h-6" />
      </form>
    </AuthPageFrame>
  );
}
