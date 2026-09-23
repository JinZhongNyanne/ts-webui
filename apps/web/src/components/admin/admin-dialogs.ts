/**
 * The M2 admin tool dialogs share the one dialog slot in client-dialogs.ts;
 * this narrows that union to ours, for `AdminDialogs.vue`.
 */
import type { ClientDialog } from "../client/client-dialogs";

const ADMIN_KINDS = [
  "complain",
  "complaints",
  "inbox",
  "composeMessage",
  "clientDb",
  "tempPasswords",
] as const;

export type AdminDialog = Extract<ClientDialog, { kind: (typeof ADMIN_KINDS)[number] }>;

export function isAdminDialog(d: ClientDialog | null): d is AdminDialog {
  return !!d && (ADMIN_KINDS as readonly string[]).includes(d.kind);
}

/** Who an offline message goes to (RecipientPicker). */
export interface Recipient {
  readonly uid: string;
  readonly nickname: string;
}
