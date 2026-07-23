import { describe, expect, it, vi } from "vitest";
import {
  type PwaServiceWorkerRuntime,
  registerPwaServiceWorker,
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
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
