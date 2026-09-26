import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { authClient } from "@/auth-client";
import { useI18n } from "@/i18n";
import { errorMessage, isUntrustedOriginError } from "@/lib/error";

/**
 * Better Auth's `signOut()` resolves with `{ error }` instead of throwing when
 * the server refuses. Treating that as success leaves the session cookie in
 * place, so `/login` immediately bounces back into the workspace and sign-out
 * silently "does nothing". Only leave the workspace once the server agreed.
 */
export function useSignOut() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return async () => {
    let result: Awaited<ReturnType<typeof authClient.signOut>> | undefined;
    try {
      result = await authClient.signOut();
    } catch {
      // Offline: nothing more the server can tell us; clear local state.
    }
    if (result?.error) {
      toast.error(
        isUntrustedOriginError(result.error)
          ? t("toast.untrustedOrigin", { origin: window.location.origin })
          : errorMessage(result.error, t("auth.signOutFailed")),
      );
      return;
    }
    queryClient.clear();
    await navigate({ replace: true, to: "/login" });
  };
}
