import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { verifyEmail } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { useI18n } from "@/i18n";

export function VerifyEmailPage({ token }: { token: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<"pending" | "ok" | "error">("pending");

  const verifyQuery = useQuery({
    queryKey: ["verify-email", token],
    queryFn: () => verifyEmail(token),
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
    <AuthPageFrame title={t("auth.verifyEmailTitle")}>
      {result === "pending" && (
        <p className="text-sm text-muted-foreground">
          {t("auth.verifyEmailVerifying")}
        </p>
      )}
      {result === "ok" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("auth.verifyEmailSuccess")}
          </p>
          <Link
            className="text-sm font-medium text-flame-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      )}
      {result === "error" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-destructive">
            {t("auth.verifyEmailInvalid")}
          </p>
          <Link
            className="text-sm font-medium text-flame-600 underline-offset-4 hover:underline"
            to="/login"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      )}
    </AuthPageFrame>
  );
}
