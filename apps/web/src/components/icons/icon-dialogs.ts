/**
 * The icon manager's slot: open from the server menu to manage icons, or
 * with a target (a group, channel or client) to pick its icon. Its own slot,
 * rendered by IconDialogsHost next to the client dialogs, so opening it from
 * a group dialog simply takes that dialog's place.
 */
import { shallowRef } from "vue";
import type { IconTarget } from "../../icons/icon-set";
import { closeClientDialog } from "../client/client-dialogs";

export interface IconDialog {
  /** Null: manage the icons; otherwise pick the icon of this target. */
  readonly target: IconTarget | null;
}

export const iconDialog = shallowRef<IconDialog | null>(null);

export function openIconDialog(target: IconTarget | null = null): void {
  // One modal at a time: the group dialogs share the client slot.
  closeClientDialog();
  iconDialog.value = { target };
}

export function closeIconDialog(): void {
  iconDialog.value = null;
}
