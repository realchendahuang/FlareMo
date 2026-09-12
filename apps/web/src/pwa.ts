export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

export type PwaServiceWorkerRuntime = {
  isProduction: boolean;
  isSecureContext: boolean;
  serviceWorker?: Pick<ServiceWorkerContainer, "register">;
};

/**
 * `beforeinstallprompt` is Chromium-only and not part of the DOM lib yet, so
 * its shape is declared here. The event is stashed and replayed on a user
 * gesture, which is the only time the browser will honour `prompt()`.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

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

let cachedRegistration: Promise<ServiceWorkerRegistration | undefined> | null =
  null;

/**
 * Registers the worker at most once per page load. main.tsx triggers this on
 * startup; the update hook shares the same promise instead of racing a second
 * register call or a `getRegistration()` that may resolve before the first
 * registration has settled.
 */
export function ensurePwaServiceWorkerRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  cachedRegistration ??= registerPwaServiceWorker().catch(
    () => undefined as ServiceWorkerRegistration | undefined,
  );
  return cachedRegistration;
}

/**
 * Detects the iOS/iPadOS family. On iOS the browser never fires
 * `beforeinstallprompt`, so the UI must fall back to "Add to Home Screen"
 * instructions instead of an install button. iPadOS 13+ reports a desktop
 * `MacIntel` platform, hence the touch-point check.
 */
export function isIosDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true;
  }
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/** Reads whether the app is already running as an installed window. */
export function isStandaloneDisplay(input: {
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
}): boolean {
  return input.displayModeStandalone || input.navigatorStandalone;
}

/**
 * Minimal structural types for the parts of the service worker API the update
 * watcher touches. Narrowing to this keeps the watcher unit-testable without a
 * full ServiceWorkerRegistration.
 */
export type PwaRegistrationLike = {
  waiting: PwaWorkerLike | null;
  installing: PwaWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
  removeEventListener(type: "updatefound", listener: () => void): void;
};

export type PwaWorkerLike = {
  state: string;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
};

/**
 * Fires `onUpdateAvailable` when a newer worker has finished installing behind
 * an already-controlling worker. A first install (no active controller) is not
 * an update and stays silent. Returns a cleanup function.
 */
export function watchServiceWorkerUpdate(options: {
  registration: PwaRegistrationLike;
  hasController: boolean;
  onUpdateAvailable: () => void;
}): () => void {
  const { registration, hasController, onUpdateAvailable } = options;

  // A worker already parked in `waiting` at page load means a new version was
  // installed during a previous session and is still pending.
  if (hasController && registration.waiting) {
    onUpdateAvailable();
  }

  const handleUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }
    const handleStateChange = () => {
      if (installing.state === "installed" && hasController) {
        onUpdateAvailable();
      }
    };
    installing.addEventListener("statechange", handleStateChange);
  };

  registration.addEventListener("updatefound", handleUpdateFound);
  return () =>
    registration.removeEventListener("updatefound", handleUpdateFound);
}

/**
 * Asks a waiting worker to take over, which triggers `controllerchange` and
 * lets the caller reload once. No-op when nothing is waiting.
 */
export function activateWaitingServiceWorker(
  registration: PwaRegistrationLike,
): boolean {
  const waiting = registration.waiting as
    | (PwaWorkerLike & { postMessage?: (message: unknown) => void })
    | null;
  if (!waiting?.postMessage) {
    return false;
  }
  waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
