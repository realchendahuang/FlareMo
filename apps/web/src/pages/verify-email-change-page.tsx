import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { verifyEmailChange } from "@/api";
import { AuthPageFrame } from "@/components/auth-page-frame";
import { useI18n } from "@/i18n";

export function VerifyEmailChangePage({ token }: { token: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<"pending" | "ok" | "error">("pending");

  const verifyQuery = useQuery({
    queryKey: ["verify-email-change", token],
    queryFn: () => verifyEmailChange(token),
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
    <AuthPageFrame title={t("auth.verifyEmailChangeTitle")}>
      {result === "pending" && (
        <p className="text-sm text-muted-foreground">
          {t("auth.verifyEmailVerifying")}
        </p>
      )}
      {result === "ok" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("auth.verifyEmailChangeSuccess")}
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
            {t("auth.verifyEmailChangeInvalid")}
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
