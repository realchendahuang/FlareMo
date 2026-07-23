export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

export type PwaServiceWorkerRuntime = {
  isProduction: boolean;
  isSecureContext: boolean;
  serviceWorker?: Pick<ServiceWorkerContainer, "register">;
};

function getPwaServiceWorkerRuntime(): PwaServiceWorkerRuntime {
  const serviceWorker =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined;

  return {
    isProduction: import.meta.env.PROD,
    isSecureContext:
      typeof window !== "undefined" && window.isSecureContext === true,
    serviceWorker,
  };
}

/**
 * Registers the offline app-shell worker only in a production, secure browser
 * context. Supplying a runtime keeps this behavior straightforward to test.
 */
export function registerPwaServiceWorker(
  runtime: PwaServiceWorkerRuntime = getPwaServiceWorkerRuntime(),
): Promise<ServiceWorkerRegistration | undefined> {
  if (
    !runtime.isProduction ||
    !runtime.isSecureContext ||
    !runtime.serviceWorker
  ) {
    return Promise.resolve(undefined);
  }

  return runtime.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
  });
}
