/**
 * Redeeming a privilege key typed into the connect dialog. The hub's connect
 * request has no field for it (TeamSpeak's own `client_default_token`), so
 * the key is redeemed with `privilegekeyuse` as soon as the connection is up.
 * It is never stored: a key is single-use, and it grants a group.
 */
import { watch } from "vue";
import { t } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { errorText } from "../admin/useBusy";
import { redeemPrivilegeKey } from "./server-actions";

/** Longer than any connect the hub allows; after it the key is dropped unused. */
const REDEEM_WAIT_MS = 60_000;

let pending: (() => void) | null = null;

/** Redeems `key` once the connection now starting is up; a newer call replaces it. */
export function redeemOnConnect(key: string): void {
  pending?.();
  const ts = useTsStore();
  const stopWatch = watch(
    () => ts.connState,
    (state) => {
      if (state === "connected") {
        cancel();
        void redeem(key);
      } else if (state === "idle") {
        // The attempt failed or was cancelled: the key goes with it.
        cancel();
      }
    },
  );
  const timer = setTimeout(() => cancel(), REDEEM_WAIT_MS);
  function cancel(): void {
    stopWatch();
    clearTimeout(timer);
    if (pending === cancel) pending = null;
  }
  pending = cancel;
}

/** Drops a key still waiting, e.g. when the connect it was typed for failed to start. */
export function cancelRedeemOnConnect(): void {
  pending?.();
}

async function redeem(key: string): Promise<void> {
  const ts = useTsStore();
  try {
    await redeemPrivilegeKey(key);
    ts.pushEvent(t("server.pk.redeemed"), "info");
  } catch (err) {
    ts.pushEvent(t("server.pk.redeemFailed", { reason: errorText(err) }), "error");
  }
}
