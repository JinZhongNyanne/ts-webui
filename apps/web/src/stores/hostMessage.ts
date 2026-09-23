/**
 * The host message dialog (`virtualserver_hostmessage_mode` 2 and 3); mode 1
 * goes to the event log. See `chat/hostMessage.ts` for the rules.
 *
 * Listens to the hub for `connected` directly, like the chat history does, so
 * the ts store needs no changes; the store's own listener runs first, so the
 * "connected to …" line is already in the log when ours is added.
 */
import { shallowRef } from "vue";
import { defineStore } from "pinia";
import { hub } from "../ts/hub";
import { t } from "../i18n";
import { useTsStore } from "./ts";
import { hostMessageAction } from "../chat/hostMessage";

export interface HostMessageDialog {
  serverName: string;
  text: string;
  /** Mode 3: we were sent away; the dialog explains why. */
  disconnected: boolean;
}

export const useHostMessageStore = defineStore("hostMessage", () => {
  const ts = useTsStore();
  const dialog = shallowRef<HostMessageDialog | null>(null);

  hub.onMessage((msg) => {
    if (msg.type !== "connected") return;
    const action = hostMessageAction(msg.server);
    if (action.kind === "log") {
      ts.pushEvent(t("hostMessage.logLine", { text: action.text }));
      return;
    }
    if (action.kind !== "modal") return;
    dialog.value = {
      serverName: msg.server.name,
      text: action.text,
      disconnected: action.disconnect,
    };
    if (action.disconnect) ts.disconnect();
  });

  function dismiss(): void {
    dialog.value = null;
  }

  return { dialog, dismiss };
});
