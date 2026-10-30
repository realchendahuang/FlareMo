import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { type TranslationKey, useI18n } from "@/i18n";

/**
 * Shared token-confirmation flow behind /verify-email and
 * /verify-email-change: fire the token at its endpoint once, then render
 * pending / success / invalid inside the auth frame. The pages differ only
 * in endpoint, query key and copy — all three arrive as props.
 */
export function VerifyTokenPage({
  token,
  queryKey,
  verify,
  title,
  success,
  invalid,
}: {
  token: string;
  queryKey: string;
  verify: (token: string) => Promise<unknown>;
  title: TranslationKey;
  success: TranslationKey;
  invalid: TranslationKey;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<"pending" | "ok" | "error">("pending");

  const verifyQuery = useQuery({
    queryKey: [queryKey, token],
    queryFn: () => verify(token),
    retry: false,
    enabled: token.length > 0,
  });

  useEffect(() => {
    if (token.length === 0) {
      setResult("error");
      return;
    }
    if (verifyQuery.isSuccess) setResult("ok");
    if (verifyQuery.isError) setResult("error");
  }, [token, verifyQuery.isSuccess, verifyQuery.isError]);

  return (
    <AuthPageFrame title={t(title)}>
      {result === "pending" && (
        <p className="text-sm text-muted-foreground">
          {t("auth.verifyEmailVerifying")}
        </p>
      )}
      {result === "ok" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {t(success)}
          </p>
          <Link
            className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      )}
      {result === "error" && (
        <div className="flex flex-col gap-3">
          {/* An expired link is a dead end to explain, not an alarm: muted
              like the success copy, so the one link below stays the only
              colored thing on the card. */}
          <p className="text-sm leading-6 text-muted-foreground">
            {t(invalid)}
          </p>
          <Link
            className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      )}
    </AuthPageFrame>
  );
}
