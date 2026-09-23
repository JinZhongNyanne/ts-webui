import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useHubAccessStore } from "./hubAccess";

type Route = (init?: RequestInit) => { status: number; body?: unknown };

/** A fake hub: each path answers with whatever its route returns right now. */
function fakeHub(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response("", { status: 404 });
    const { status, body } = route(init);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  });
  return calls;
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.unstubAllGlobals());

describe("hub access", () => {
  it("opens straight away when the hub has no password", async () => {
    fakeHub({
      "/api/auth": () => ({ status: 200, body: { required: false, authenticated: true } }),
      "/api/config": () => ({ status: 200, body: { fixedServer: true, defaultServer: "" } }),
    });
    const access = useHubAccessStore();
    await access.check();
    expect(access.state).toBe("open");
    expect(access.passwordRequired).toBe(false);
    expect(access.fixedServer).toBe(true);
  });

  it("stays locked until the right password, then loads the config", async () => {
    let authed = false;
    const calls = fakeHub({
      "/api/auth": () => ({ status: 200, body: { required: true, authenticated: authed } }),
      "/api/auth/login": (init) => {
        const { password } = JSON.parse(String(init?.body)) as { password: string };
        if (password !== "pw") return { status: 401 };
        authed = true;
        return { status: 200, body: { ok: true } };
      },
      "/api/config": () => ({ status: 200, body: { fixedServer: false, defaultServer: "a:1" } }),
    });
    const access = useHubAccessStore();
    await access.check();
    expect(access.state).toBe("locked");
    expect(calls).not.toContain("/api/config");

    expect(await access.login("nope")).toBe("wrong");
    expect(access.state).toBe("locked");

    expect(await access.login("pw")).toBeNull();
    expect(access.state).toBe("open");
    expect(access.defaultServer).toBe("a:1");
  });

  it("reports rate limiting and an unreachable hub", async () => {
    fakeHub({
      "/api/auth/login": () => ({ status: 429 }),
      "/api/auth": () => ({ status: 502 }),
    });
    const access = useHubAccessStore();
    expect(await access.login("pw")).toBe("rateLimited");
    await access.check();
    expect(access.state).toBe("unreachable");
  });

  it("locks again on logout or when the hub refuses the socket", async () => {
    fakeHub({ "/api/auth/logout": () => ({ status: 200, body: { ok: true } }) });
    const access = useHubAccessStore();
    access.state = "open";
    await access.logout();
    expect(access.state).toBe("locked");

    access.state = "open";
    access.markLocked();
    expect(access.state).toBe("locked");
    expect(access.passwordRequired).toBe(true);
  });
});
