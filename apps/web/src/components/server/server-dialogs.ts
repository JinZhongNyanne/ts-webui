/**
 * The M4 server dialogs share the one dialog slot in client-dialogs.ts; this
 * narrows that union to ours, for `ServerDialogs.vue`.
 */
import type { ClientDialog } from "../client/client-dialogs";

const SERVER_KINDS = [
  "privilegeKeyUse",
  "privilegeKeys",
  "groups",
  "serverEdit",
  "serverLog",
  "permOverview",
] as const;

export type ServerDialog = Extract<ClientDialog, { kind: (typeof SERVER_KINDS)[number] }>;

export function isServerDialog(d: ClientDialog | null): d is ServerDialog {
  return !!d && (SERVER_KINDS as readonly string[]).includes(d.kind);
}
