import { useCallback, useEffect, useRef, useState } from "react";
import {
  activateWaitingServiceWorker,
  type BeforeInstallPromptEvent,
  ensurePwaServiceWorkerRegistration,
  isIosDevice,
  isStandaloneDisplay,
  type PwaRegistrationLike,
  watchServiceWorkerUpdate,
} from "@/pwa";

type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export type PwaInstallState = {
  /** True while the app is running as an installed (standalone) window. */
  isInstalled: boolean;
  /** True when the browser can show its native install prompt right now. */
  canPromptInstall: boolean;
  /** True on iOS/iPadOS, where install is a manual "Add to Home Screen" flow. */
  isIos: boolean;
  /** Replays the stashed prompt. Resolves with the user's choice. */
  promptInstall: () => Promise<InstallOutcome>;
};

const INSTALL_DISMISSED_KEY = "flaremo.pwa.install-dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    // Storage disabled (private mode); the prompt just reappears next visit.
  }
}

/**
 * Exposes install affordances. Chromium browsers surface `beforeinstallprompt`;
 * iOS never does, so callers show manual instructions there instead. A dismissal
 * is remembered so the in-app entry point can stay hidden after the user opts
 * out.
 */
export function usePwaInstall(): PwaInstallState & {
  /** True when the in-app install entry point should be offered. */
  shouldOfferInstall: boolean;
  /** Records that the user dismissed the in-app install entry point. */
  dismissInstall: () => void;
} {
  const [isInstalled, setIsInstalled] = useState(() =>
    isStandaloneDisplay({
      displayModeStandalone:
        typeof window !== "undefined" &&
        window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone:
        typeof navigator !== "undefined" &&
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    }),
  );
  const [isIos] = useState(() =>
    typeof navigator === "undefined"
      ? false
      : isIosDevice(
          navigator.userAgent,
          navigator.platform,
          navigator.maxTouchPoints,
        ),
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPromptInstall, setCanPromptInstall] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      // Suppress the browser's own mini-infobar so the app controls the moment.
      event.preventDefault();
      promptEventRef.current = event as BeforeInstallPromptEvent;
      setCanPromptInstall(true);
    };
    const handleInstalled = () => {
      promptEventRef.current = null;
      setCanPromptInstall(false);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const promptEvent = promptEventRef.current;
    if (!promptEvent) return "unavailable";

    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // A prompt can only be used once; drop it regardless of the outcome.
    promptEventRef.current = null;
    setCanPromptInstall(false);
    if (outcome === "accepted") {
      setIsInstalled(true);
    } else {
      writeDismissed();
      setDismissed(true);
    }
    return outcome;
  }, []);

  const dismissInstall = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  return {
    isInstalled,
    canPromptInstall,
    isIos,
    promptInstall,
    shouldOfferInstall:
      !isInstalled && !dismissed && (canPromptInstall || isIos),
    dismissInstall,
  };
}

export type PwaUpdateState = {
  updateAvailable: boolean;
  /** Activates the waiting worker and reloads once the new one controls the page. */
  applyUpdate: () => void;
};

/**
 * Detects a newer deployed worker and lets the user adopt it deliberately, so a
 * background update never reloads the page mid-edit. main.tsx owns registration;
 * this hook only observes the registration it produced.
 */
export function usePwaUpdate(): PwaUpdateState {
  const [registration, setRegistration] = useState<PwaRegistrationLike | null>(
    null,
  );
  const [hasController, setHasController] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    const container = navigator.serviceWorker;
    // Absent in dev and non-secure contexts, where the worker is never registered.
    if (!container) return;

    let cancelled = false;
    setHasController(Boolean(container.controller));

    void ensurePwaServiceWorkerRegistration()
      .then((registered) => {
        if (cancelled || !registered) return;
        setRegistration(registered);
      })
      .catch(() => undefined);

    // A controller appearing for the first time (or changing) means the active
    // worker was replaced. Reload only when the user asked for the update.
    const handleControllerChange = () => {
      setHasController(true);
      if (reloadingRef.current) {
        window.location.reload();
      }
    };
    container.addEventListener("controllerchange", handleControllerChange);

    return () => {
      cancelled = true;
      container.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!registration) return;
    const stop = watchServiceWorkerUpdate({
      registration,
      hasController,
      onUpdateAvailable: () => setUpdateAvailable(true),
    });
    return stop;
  }, [registration, hasController]);

  const applyUpdate = useCallback(() => {
    if (!registration) return;
    reloadingRef.current = true;
    if (!activateWaitingServiceWorker(registration)) {
      // No waiting worker (already activated): a plain reload is enough.
      window.location.reload();
    }
  }, [registration]);

  return { updateAvailable, applyUpdate };
}
