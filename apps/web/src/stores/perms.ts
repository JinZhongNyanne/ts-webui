/**
 * What the TeamSpeak server lets this client do, by permission name, so menus
 * can hide what would only fail (see ts/perms.ts for the value rules).
 *
 * Fed by the hub's `perms` messages: the full set shortly after connecting,
 * then patches when our groups change. Everything is dropped whenever the
 * TeamSpeak link or the hub socket goes away, so a reconnect to another
 * server never inherits the last one's rights.
 *
 * Instantiated from main.ts: the first (full) message arrives right after
 * connecting, before any component that reads it may exist.
 *
 *   const perms = usePermsStore();
 *   const canKick = computed(() => perms.has("i_client_kick_from_server_power"));
 */
import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { ServerMessage } from "@jinz/protocol";
import { hub } from "../ts/hub";
import type { CommandTransport } from "../ts/commands";
import { applyPerms, permHas, permValue, powerCovers, type PermValues, mayUse } from "../ts/perms";

type PermsSource = Pick<CommandTransport, "onMessage" | "onState">;

export function createPermsStore(source: PermsSource) {
  return () => {
    const values = shallowRef<PermValues>({});
    /** False until the first full set arrives; before that every check says no. */
    const loaded = shallowRef(false);

    function reset(): void {
      values.value = {};
      loaded.value = false;
    }

    function onMessage(msg: ServerMessage): void {
      switch (msg.type) {
        case "perms":
          // A patch before the full set belongs to nothing we know; wait for it.
          if (!msg.full && !loaded.value) return;
          values.value = applyPerms(values.value, msg);
          loaded.value = true;
          return;
        case "connecting":
        case "disconnected":
          reset();
          return;
        case "error":
          if (msg.fatal) reset();
          return;
      }
    }

    source.onMessage(onMessage);
    source.onState((state) => {
      if (state === "closed") reset();
    });

    return {
      values: computed(() => values.value),
      loaded: computed(() => loaded.value),
      /** The raw value; 0 when the server never reported it. */
      value: (name: string) => permValue(values.value, name),
      /** A granted flag, or a value of at least `min`. */
      has: (name: string, min = 1) => permHas(values.value, name, min),
      /** Offer an action gated on `name`? Unknown counts as yes (see mayUse in ts/perms.ts). */
      mayUse: (name: string, min = 1) => mayUse(values.value, loaded.value, name, min),
      /** My `power` against someone's needed power (see powerCovers in ts/perms.ts). */
      covers: (power: string, needed: number) =>
        powerCovers(permValue(values.value, power), needed),
      reset,
    };
  };
}

export const usePermsStore = defineStore("perms", createPermsStore(hub));
