/**
 * The client a dialog acts on, pinned to who it was when the dialog opened.
 *
 * TeamSpeak hands a freed client id to the next client that joins (lowest
 * free first), so looking the target up by id alone would quietly switch a
 * kick or ban dialog to whoever connected after the target left. The UID is
 * captured once, at open, and a client under that id only counts while its
 * UID still matches.
 */
import { computed, watch, type ComputedRef } from "vue";
import type { TsClient } from "@jinz/protocol";

/** The client under `clientId`, if it is still the one with `uid`. */
export function matchTarget(
  clients: ReadonlyMap<number, TsClient>,
  clientId: number,
  uid: string | null,
): TsClient | null {
  const c = clients.get(clientId);
  return c && uid !== null && c.uid === uid ? c : null;
}

/**
 * Tracks `clientId` in the live `clients` map; `onGone` runs once the target
 * disappears (left, or its id went to someone else). A target that was not
 * there at open stays null and never reports gone: the dialog shows the
 * server's "invalid client" when used instead.
 */
export function useTargetClient(
  clients: ReadonlyMap<number, TsClient>,
  clientId: number,
  onGone?: () => void,
): ComputedRef<TsClient | null> {
  const uid = clients.get(clientId)?.uid ?? null;
  const target = computed(() => matchTarget(clients, clientId, uid));
  if (onGone) {
    const stop = watch(target, (c) => {
      if (c) return;
      stop();
      onGone();
    });
  }
  return target;
}
