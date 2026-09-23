import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker, SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL } from "./register";

/** A container whose register() resolves, recording what it was asked for. */
function fakeContainer() {
  const calls: { url: string; scope: string | undefined }[] = [];
  return {
    calls,
    register: (url: string, options?: { scope?: string }) => {
      calls.push({ url, scope: options?.scope });
      return Promise.resolve({ scope: SERVICE_WORKER_SCOPE });
    },
  };
}

describe("registerServiceWorker", () => {
  it("registers the worker at the app's root scope in production", async () => {
    const container = fakeContainer();
    const outcome = await registerServiceWorker({ container, isProduction: true });
    expect(outcome).toBe("registered");
    expect(container.calls).toEqual([{ url: SERVICE_WORKER_URL, scope: SERVICE_WORKER_SCOPE }]);
  });

  it("stays out of dev and test runs, where a caching worker only confuses things", async () => {
    const container = fakeContainer();
    expect(await registerServiceWorker({ container, isProduction: false })).toBe("skipped");
    expect(container.calls).toEqual([]);
  });

  it("does nothing when the browser has no service workers (a private window, http)", async () => {
    expect(await registerServiceWorker({ container: undefined, isProduction: true })).toBe(
      "unsupported",
    );
  });

  it("reports a rejected registration instead of letting it reach app startup", async () => {
    const log = vi.fn();
    const outcome = await registerServiceWorker({
      container: { register: () => Promise.reject(new Error("404")) },
      isProduction: true,
      log,
    });
    expect(outcome).toBe("failed");
    expect(log).toHaveBeenCalledOnce();
  });

  it("survives a container that throws synchronously", async () => {
    const outcome = await registerServiceWorker({
      container: {
        register: () => {
          throw new Error("SecurityError");
        },
      },
      isProduction: true,
      log: () => undefined,
    });
    expect(outcome).toBe("failed");
  });
});
