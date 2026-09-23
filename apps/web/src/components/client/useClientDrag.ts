/**
 * Drag a client row onto a channel row to move them there, as in the native
 * client. Dragging ourselves is a join (through the tree's own join, which
 * asks for a password where needed); dragging someone else needs the move
 * power (unknown counts as yes, see useModerationMenus) and moves them at
 * once, or opens the move dialog for a channel with a password.
 *
 * Mouse only: touch browsers do not fire HTML5 drag events, and the menu's
 * "Move to…" covers them.
 */
import { ref } from "vue";
import type { TsChannel, TsClient } from "@jinz/protocol";
import { useTsStore } from "../../stores/ts";
import { dropDecision } from "../../ts/moderation";
import { moveClient } from "../../ts/moderation-actions";
import { openClientDialog } from "./client-dialogs";
import { useModerationMenus } from "./useModerationMenus";

/** Marks our drags, so a file or text dragged in from elsewhere is ignored. */
const DRAG_TYPE = "application/x-jinz-client";

export function useClientDrag(options: {
  join: (channel: TsChannel) => void;
  run: (action: Promise<void>) => void;
}) {
  const ts = useTsStore();
  const moderation = useModerationMenus();
  /** The client being dragged; dragover cannot read the drag's data, so it lives here. */
  const dragging = ref<number | null>(null);
  /** The channel row under the pointer that would accept the drop. */
  const dropTarget = ref<string | null>(null);

  function decisionFor(channel: TsChannel) {
    const c = dragging.value === null ? undefined : ts.clients.get(dragging.value);
    return c ? { client: c, decision: dropDecision(c, channel, moderation.canMove(c)) } : null;
  }

  function onDragStart(ev: DragEvent, c: TsClient): void {
    if (!moderation.canMove(c) || !ev.dataTransfer) {
      ev.preventDefault();
      return;
    }
    dragging.value = c.id;
    ev.dataTransfer.setData(DRAG_TYPE, String(c.id));
    ev.dataTransfer.effectAllowed = "move";
  }

  function onDragEnd(): void {
    dragging.value = null;
    dropTarget.value = null;
  }

  function onDragOver(ev: DragEvent, channel: TsChannel): void {
    const found = decisionFor(channel);
    if (!found || found.decision === "none") return;
    ev.preventDefault(); // accept the drop here
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    dropTarget.value = channel.id;
  }

  function onDragLeave(ev: DragEvent, channel: TsChannel): void {
    // Moving onto the row's own children (name, badges) is not leaving it.
    const into = ev.relatedTarget as Node | null;
    const el = ev.currentTarget as HTMLElement | null;
    if (el && into && el.contains(into)) return;
    if (dropTarget.value === channel.id) dropTarget.value = null;
  }

  function onDrop(ev: DragEvent, channel: TsChannel): void {
    const found = decisionFor(channel);
    onDragEnd();
    if (!found) return;
    ev.preventDefault();
    const { client, decision } = found;
    if (decision === "join") options.join(channel);
    else if (decision === "move") options.run(moveClient(client.id, channel.id));
    else if (decision === "dialog") {
      openClientDialog({ kind: "move", clientId: client.id, channelId: channel.id });
    }
  }

  return {
    dropTarget,
    canDrag: (c: TsClient) => moderation.canMove(c),
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
