/**
 * Reloads the page unless this tab already did so within the last minute.
 * Shares its marker with public/boot.js, so the boot guard and a failed chunk
 * load cannot take turns reloading forever when something is really broken.
 */
export const RELOAD_KEY = "jinz.bootReloadAt";
export const RELOAD_WINDOW_MS = 60_000;

export interface ReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
}

/** True when it reloaded; false when it recently did and the caller must cope. */
export function reloadOnce(deps?: Partial<ReloadDeps>): boolean {
  const reload = deps?.reload ?? (() => window.location.reload());
  const now = deps?.now ?? Date.now;
  try {
    // Looked up inside the try: touching sessionStorage can itself throw.
    const storage = deps?.storage ?? sessionStorage;
    const last = Number(storage.getItem(RELOAD_KEY)) || 0;
    if (now() - last <= RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now()));
  } catch {
    // Without storage a loop cannot be ruled out.
    return false;
  }
  reload();
  return true;
}
