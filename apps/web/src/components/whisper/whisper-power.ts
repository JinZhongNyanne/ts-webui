/**
 * Whether to warn that this client's whispers may reach nobody.
 *
 * The TeamSpeak server lets a whisper through to someone only when the
 * whisperer's `i_client_whisper_power` is at least that person's
 * `i_client_needed_whisper_power`, and drops the rest without a word: the
 * whisperer hears nothing back, and neither does anyone else. So the page says
 * so itself, next to the whisper pill and in the whisper pane.
 *
 * Only our own power is known — the others' needed power is behind
 * b_client_permissionoverview_view, which few have — so the warning is about
 * the one case we can see: a power the server reported as 0. It is a "may":
 * a server that sets no needed whisper power on anyone (TeamSpeak's default,
 * checked on a live 3.13 server) still delivers such a whisper, which is why
 * the key is never blocked. A power the hub never learned (no
 * b_client_permissionoverview_own) is unknown, not zero, and stays quiet.
 */
import type { PermValues } from "../../ts/perms";

export const WHISPER_POWER = "i_client_whisper_power";

export function lacksWhisperPower(values: PermValues, loaded: boolean): boolean {
  if (!loaded || !(WHISPER_POWER in values)) return false;
  return values[WHISPER_POWER] === 0;
}
