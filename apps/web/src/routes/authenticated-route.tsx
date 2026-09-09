import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AUTHENTICATION_REQUIRED_EVENT } from "@/api";
import { authClient } from "@/auth-client";
import { RouteLoading } from "@/routes/route-loading";

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  // One-shot guard: the redirect navigation must fire exactly once per
  // destination, otherwise the guard and the login page ping-pong the
  // router (which crashed the renderer in an endless navigation loop).
  const redirectedDestination = useRef<string | null>(null);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      queryClient.clear();
      setAuthenticationRequired(true);
    };
    window.addEventListener(
      AUTHENTICATION_REQUIRED_EVENT,
      handleAuthenticationRequired,
    );
    return () =>
      window.removeEventListener(
        AUTHENTICATION_REQUIRED_EVENT,
        handleAuthenticationRequired,
      );
  }, [queryClient]);

  // Preserve the intended destination so sign-in can return the user here.
  // `href` is the full current path (pathname + search + hash); `search` on
  // the location object is the PARSED params, and must never be coerced.
  const destination = location.href;

  useEffect(() => {
    if (session.isPending || session.data?.user) return;
    // Never bounce from the login page itself (or the root): the redirect
    // value would otherwise wrap the current URL recursively.
    if (destination === "/" || destination.startsWith("/login")) return;
    if (redirectedDestination.current === destination) return;
    redirectedDestination.current = destination;
    void navigate({
      replace: true,
      search: { redirect: destination },
      to: "/login",
    });
  }, [destination, navigate, session.data, session.isPending]);

  if (session.isPending) {
    return <RouteLoading />;
  }
  if (authenticationRequired || !session.data?.user) {
    return <RouteLoading />;
  }
  return children;
}
