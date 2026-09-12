import { describe, expect, it, vi } from "vitest";
import {
  activateWaitingServiceWorker,
  isIosDevice,
  isStandaloneDisplay,
  type PwaRegistrationLike,
  type PwaServiceWorkerRuntime,
  type PwaWorkerLike,
  registerPwaServiceWorker,
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  watchServiceWorkerUpdate,
} from "./pwa";

describe("registerPwaServiceWorker", () => {
  it("registers the root-scoped worker in a secure production runtime", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn(() => Promise.resolve(registration));
    const runtime: PwaServiceWorkerRuntime = {
      isProduction: true,
      isSecureContext: true,
      serviceWorker: { register },
    };

    await expect(registerPwaServiceWorker(runtime)).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
    });
  });

  it("does not register outside a secure production browser", async () => {
    const register = vi.fn();

    await expect(
      registerPwaServiceWorker({
        isProduction: false,
        isSecureContext: true,
        serviceWorker: { register },
      }),
    ).resolves.toBeUndefined();

    await expect(
      registerPwaServiceWorker({
        isProduction: true,
        isSecureContext: false,
        serviceWorker: { register },
      }),
    ).resolves.toBeUndefined();

    expect(register).not.toHaveBeenCalled();
  });
});

describe("isIosDevice", () => {
  it("detects iPhone and iPad user agents", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "", 5)).toBe(
      true,
    );
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 16_0)", "", 5)).toBe(true);
  });

  it("detects iPadOS desktop-mode Safari via touch points", () => {
    expect(
      isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5),
    ).toBe(true);
  });

  it("rejects desktop and Android browsers", () => {
    expect(
      isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0),
    ).toBe(false);
    expect(
      isIosDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5),
    ).toBe(false);
  });
});

describe("isStandaloneDisplay", () => {
  it("treats either standalone signal as installed", () => {
    expect(
      isStandaloneDisplay({
        displayModeStandalone: true,
        navigatorStandalone: false,
      }),
    ).toBe(true);
    expect(
      isStandaloneDisplay({
        displayModeStandalone: false,
        navigatorStandalone: true,
      }),
    ).toBe(true);
    expect(
      isStandaloneDisplay({
        displayModeStandalone: false,
        navigatorStandalone: false,
      }),
    ).toBe(false);
  });
});

function createWorker(state = "installing"): PwaWorkerLike & {
  setState: (next: string) => void;
} {
  const listeners = new Set<() => void>();
  const worker = {
    state,
    addEventListener: (_type: "statechange", listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "statechange", listener: () => void) => {
      listeners.delete(listener);
    },
    setState: (next: string) => {
      worker.state = next;
      for (const listener of listeners) listener();
    },
  };
  return worker;
}

function createRegistration(options: {
  waiting?: PwaWorkerLike | null;
  installing?: PwaWorkerLike | null;
}): PwaRegistrationLike & { fireUpdateFound: () => void } {
  const listeners = new Set<() => void>();
  const registration = {
    waiting: options.waiting ?? null,
    installing: options.installing ?? null,
    addEventListener: (_type: "updatefound", listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "updatefound", listener: () => void) => {
      listeners.delete(listener);
    },
    fireUpdateFound: () => {
      for (const listener of listeners) listener();
    },
  };
  return registration;
}

describe("watchServiceWorkerUpdate", () => {
  it("reports a worker that is already waiting when a controller exists", () => {
    const onUpdateAvailable = vi.fn();
    watchServiceWorkerUpdate({
      registration: createRegistration({ waiting: createWorker("installed") }),
      hasController: true,
      onUpdateAvailable,
    });
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("ignores a waiting worker on a first install with no controller", () => {
    const onUpdateAvailable = vi.fn();
    watchServiceWorkerUpdate({
      registration: createRegistration({ waiting: createWorker("installed") }),
      hasController: false,
      onUpdateAvailable,
    });
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("reports a newly installed worker once it finishes installing", () => {
    const worker = createWorker("installing");
    const registration = createRegistration({ installing: worker });
    const onUpdateAvailable = vi.fn();

    watchServiceWorkerUpdate({
      registration,
      hasController: true,
      onUpdateAvailable,
    });
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    registration.fireUpdateFound();
    worker.setState("installed");
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("stops observing after cleanup", () => {
    const worker = createWorker("installing");
    const registration = createRegistration({ installing: worker });
    const onUpdateAvailable = vi.fn();

    const stop = watchServiceWorkerUpdate({
      registration,
      hasController: true,
      onUpdateAvailable,
    });
    stop();
    registration.fireUpdateFound();
    worker.setState("installed");
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });
});

describe("activateWaitingServiceWorker", () => {
  it("posts SKIP_WAITING to a waiting worker", () => {
    const postMessage = vi.fn();
    const waiting = Object.assign(createWorker("installed"), { postMessage });

    expect(activateWaitingServiceWorker(createRegistration({ waiting }))).toBe(
      true,
    );
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("does nothing when no worker is waiting", () => {
    expect(activateWaitingServiceWorker(createRegistration({}))).toBe(false);
  });
});
