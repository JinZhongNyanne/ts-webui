import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import {
  MAX_APPS,
  normalizeAppUrl,
  type AppUrlError,
  type ServerMessage,
  type SharedApp,
} from "@jinz/protocol";
import { hub } from "../ts/hub";
import { assetToken, hasAssetToken } from "../ts/asset-token";
import { useTsStore } from "./ts";
import {
  EMPTY_OPENED,
  closeSite,
  openSite,
  parseOpened,
  pruneOpened,
  type OpenedState,
} from "../webapps/opened";
import { clampZoom, parseZooms, stepZoom } from "../webapps/zoom";

const OPENED_KEY = "jinz.apps.opened";
const ZOOM_KEY = "jinz.apps.zoom";

export type AddAppError = AppUrlError | "full" | "exists" | "failed";

function loadOpened(): OpenedState {
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    return parseOpened(raw ? JSON.parse(raw) : null);
  } catch {
    return EMPTY_OPENED;
  }
}

function loadZooms(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    return parseZooms(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

/**
 * The Apps window. The site list is the hub's and shared by everyone on it:
 * fetched on connect, then kept current by `apps.updated` pushes whenever
 * anyone adds or removes a site (or an icon arrives). Which sites this user
 * has open, which one is showing, and how far each is zoomed, stays in this
 * browser.
 */
export const useWebAppsStore = defineStore("webApps", () => {
  const ts = useTsStore();
  const apps = shallowRef<SharedApp[]>([]);
  const opened = ref<OpenedState>(loadOpened());
  /** Zoom per site id; a site at 100% has no entry. */
  const zooms = ref<Record<string, number>>(loadZooms());
  /** True once the hub's list arrived; before that, pruning would close every tab. */
  const loaded = ref(false);

  const byId = computed(() => new Map(apps.value.map((a) => [a.id, a])));
  const openedApps = computed(() =>
    opened.value.ids.map((id) => byId.value.get(id)).filter((a): a is SharedApp => !!a),
  );
  const active = computed(() =>
    opened.value.active ? (byId.value.get(opened.value.active) ?? null) : null,
  );

  watch(
    opened,
    (state) => {
      try {
        localStorage.setItem(OPENED_KEY, JSON.stringify(state));
      } catch {
        // Storage full or blocked: tabs still work for this page.
      }
    },
    { deep: true },
  );

  watch(
    zooms,
    (z) => {
      try {
        localStorage.setItem(ZOOM_KEY, JSON.stringify(z));
      } catch {
        // As above.
      }
    },
    { deep: true },
  );

  function zoomOf(id: string): number {
    return zooms.value[id] ?? 1;
  }

  function setZoom(id: string, zoom: number): void {
    const { [id]: _old, ...rest } = zooms.value;
    const next = clampZoom(zoom);
    zooms.value = next === 1 ? rest : { ...rest, [id]: next };
  }

  function zoomBy(id: string, direction: 1 | -1): void {
    setZoom(id, stepZoom(zoomOf(id), direction));
  }

  function setList(list: SharedApp[]): void {
    apps.value = list;
    loaded.value = true;
    opened.value = pruneOpened(opened.value, new Set(list.map((a) => a.id)));
  }

  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/apps", { headers: { "x-session-id": ts.sessionId } });
      if (res.ok) setList(((await res.json()) as { apps: SharedApp[] }).apps);
    } catch {
      // Hub unreachable: the list stays as it was until the next push or connect.
    }
  }

  hub.onMessage((msg: ServerMessage) => {
    if (msg.type === "apps.updated") setList(msg.apps);
  });
  watch(
    () => ts.connState,
    (state) => {
      if (state === "connected") void refresh();
    },
    { immediate: true },
  );

  /** Adds a site for everyone and opens it here; returns why not when it cannot. */
  async function add(name: string, url: string): Promise<AddAppError | null> {
    if (apps.value.length >= MAX_APPS) return "full";
    // The hub checks again; this answers the common mistakes without a round trip.
    const checked = normalizeAppUrl(url, [location.origin]);
    if ("error" in checked) return checked.error;
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "x-session-id": ts.sessionId, "content-type": "application/json" },
        body: JSON.stringify({ name, url: checked.url }),
      });
      const data = (await res.json().catch(() => ({}))) as { app?: SharedApp; error?: string };
      if (!res.ok || !data.app) {
        const known: AddAppError[] = ["invalid", "sameOrigin", "full", "exists"];
        return known.includes(data.error as AddAppError) ? (data.error as AddAppError) : "failed";
      }
      // The push may not have arrived yet; the site must exist before it opens.
      if (!byId.value.has(data.app.id)) apps.value = [...apps.value, data.app];
      open(data.app.id);
      return null;
    } catch {
      return "failed";
    }
  }

  /** Removes a site for everyone. */
  async function remove(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-session-id": ts.sessionId },
      });
      if (res.ok || res.status === 404) setList(apps.value.filter((a) => a.id !== id));
      return res.ok;
    } catch {
      return false;
    }
  }

  function open(id: string): void {
    opened.value = openSite(opened.value, id);
  }

  function close(id: string): void {
    opened.value = closeSite(opened.value, id);
  }

  /** The hub-served icon; null when the site has none (or before a token arrives). */
  function iconUrl(app: SharedApp): string | null {
    if (app.iconRev === null || !hasAssetToken.value) return null;
    return `/api/app-icon/${encodeURIComponent(app.id)}?rev=${app.iconRev}&token=${assetToken()}`;
  }

  return {
    apps,
    loaded,
    openedApps,
    active,
    add,
    remove,
    open,
    close,
    iconUrl,
    refresh,
    zoomOf,
    setZoom,
    zoomBy,
  };
});
