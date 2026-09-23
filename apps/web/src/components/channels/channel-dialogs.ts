/**
 * Which channel dialog is open, if any: one slot, rendered by
 * `ChannelDialogsHost` (mounted from ClientDialogsHost), so the tree's
 * context menu and any other entry point open the same dialog.
 */
import { shallowRef } from "vue";

export type ChannelDialog =
  /** A new channel under `parentId` ("0" = top level). */
  | { kind: "create"; parentId: string }
  | { kind: "edit"; channelId: string }
  /** New parent and position, the menu's stand-in for dragging (phones, keyboards). */
  | { kind: "move"; channelId: string };

/** The two the tabbed create / edit form handles (ChannelEditDialog). */
export type ChannelFormDialog = Extract<ChannelDialog, { kind: "create" | "edit" }>;

export const channelDialog = shallowRef<ChannelDialog | null>(null);

export function openChannelDialog(dialog: ChannelDialog): void {
  channelDialog.value = dialog;
}

export function closeChannelDialog(): void {
  channelDialog.value = null;
}
