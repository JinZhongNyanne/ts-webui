/**
 * Getting into the hub: the hub password (when the operator set one) and the
 * bits of `/api/config` the connect form needs.
 *
 * The password itself never stays in the page. Logging in makes the hub set an
 * HttpOnly cookie, which the browser then sends with every `/api` call and the
 * websocket handshake on its own.
 */
import { ref } from "vue";
import { defineStore } from "pinia";

/**
 * checking: asking the hub; locked: needs the password; open: may connect;
 * unreachable: the hub did not answer.
 */
export type HubAccessState = "checking" | "locked" | "open" | "unreachable";

export type LoginError = "wrong" | "rateLimited" | "failed";

interface HubConfigResponse {
  fixedServer?: boolean;
  defaultServer?: string;
  /** Fixed-server mode: the server's public address, when the hub may tell it. */
  publicServer?: { host: string; port: number } | null;
}

export const useHubAccessStore = defineStore("hubAccess", () => {
  const state = ref<HubAccessState>("checking");
  /** Whether the hub asks for a password at all (drives the "log out" button). */
  const passwordRequired = ref(false);
  /** The hub always dials its own server: the form only asks for a nickname. */
  const fixedServer = ref(false);
  const defaultServer = ref("");
  const publicServer = ref<{ host: string; port: number } | null>(null);

  async function check(): Promise<void> {
    state.value = "checking";
    try {
      const res = await fetch("/api/auth");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { required: boolean; authenticated: boolean };
      passwordRequired.value = body.required;
      if (!body.authenticated) {
        state.value = "locked";
        return;
      }
      await loadConfig();
      state.value = "open";
    } catch {
      state.value = "unreachable";
    }
  }

  async function loadConfig(): Promise<void> {
    const res = await fetch("/api/config");
    if (res.status === 401) throw new Error("locked");
    if (!res.ok) return;
    const cfg = (await res.json()) as HubConfigResponse;
    fixedServer.value = cfg.fixedServer === true;
    defaultServer.value = cfg.defaultServer ?? "";
    publicServer.value = cfg.publicServer ?? null;
  }

  /** Resolves to null on success, otherwise why it failed. */
  async function login(password: string): Promise<LoginError | null> {
    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      return "failed";
    }
    if (res.status === 401) return "wrong";
    if (res.status === 429) return "rateLimited";
    if (!res.ok) return "failed";
    await check();
    return state.value === "open" ? null : "failed";
  }

  async function logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      state.value = "locked";
    }
  }

  /** The hub refused our pass: it expired, or the operator set or changed the password. */
  function markLocked(): void {
    passwordRequired.value = true;
    state.value = "locked";
  }

  return {
    state,
    passwordRequired,
    fixedServer,
    defaultServer,
    publicServer,
    check,
    login,
    logout,
    markLocked,
  };
});
