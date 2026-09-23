/**
 * Drag-and-drop of channels in the channel tree: drop onto a channel to make
 * it a subchannel (appended last), between two rows to reorder, onto the
 * server row to make it a top-level channel. The drag carries its own MIME
 * type, so other drags over the same rows (clients, files) are left alone and
 * other drop handlers can ignore ours.
 *
 * Only the rules are elsewhere (ts/channel-drop.ts); this wires them to the
 * DOM events and holds the drop indicator's state.
 *
 *   const drag = useChannelDrag();
 *   <div v-bind="drag.rowEvents(ch)" :class="drag.rowClass(ch.id)">
 */
import { shallowRef } from "vue";
import type { TsChannel } from "@jinz/protocol";
import { usePermsStore } from "../../stores/perms";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { placeChannel } from "../../ts/channel-actions";
import { dropPositionAt, planChannelDrop, type DropPosition } from "../../ts/channel-drop";
import { channelPerms } from "../../ts/channel-perms";

export const CHANNEL_DRAG_MIME = "application/x-jinz-channel";

interface DropTarget {
  /** null = the server row (top level). */
  readonly id: string | null;
  readonly position: DropPosition;
}

export function useChannelDrag() {
  const ts = useTsStore();
  const perms = usePermsStore();
  const { t } = useI18n();
  const cp = channelPerms(perms);

  const dragging = shallowRef<string | null>(null);
  const over = shallowRef<DropTarget | null>(null);

  const isOurs = (ev: DragEvent) => !!ev.dataTransfer?.types.includes(CHANNEL_DRAG_MIME);

  function positionIn(ev: DragEvent, targetId: string | null, allowAfter = true): DropPosition {
    if (targetId === null) return "inside";
    const el = ev.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    return rect ? dropPositionAt(ev.clientY - rect.top, rect.height, allowAfter) : "inside";
  }

  function planFor(target: DropTarget) {
    if (!dragging.value) return null;
    return planChannelDrop(ts.channels, dragging.value, target.id, target.position);
  }

  function onDragStart(ev: DragEvent, ch: TsChannel): void {
    if (!ev.dataTransfer) return;
    ev.dataTransfer.setData(CHANNEL_DRAG_MIME, ch.id);
    ev.dataTransfer.effectAllowed = "move";
    dragging.value = ch.id;
  }

  function onDragOver(ev: DragEvent, targetId: string | null, allowAfter = true): void {
    if (!isOurs(ev) || !dragging.value) return;
    const target = { id: targetId, position: positionIn(ev, targetId, allowAfter) };
    if (!planFor(target)) {
      over.value = null;
      return;
    }
    // Accepting the drop is what preventDefault means for dragover.
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const cur = over.value;
    if (cur?.id !== target.id || cur.position !== target.position) over.value = target;
  }

  function onDragLeave(ev: DragEvent, targetId: string | null): void {
    const into = ev.relatedTarget as Node | null;
    const el = ev.currentTarget as HTMLElement | null;
    if (el && into && el.contains(into)) return;
    if (over.value?.id === targetId) over.value = null;
  }

  function onDrop(ev: DragEvent, targetId: string | null, allowAfter = true): void {
    if (!isOurs(ev)) return;
    ev.preventDefault();
    const plan = planFor({ id: targetId, position: positionIn(ev, targetId, allowAfter) });
    reset();
    if (!plan) return;
    placeChannel(plan).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ts.pushEvent(t("chm.moveFailed", { msg }), "error");
    });
  }

  function reset(): void {
    dragging.value = null;
    over.value = null;
  }

  /**
   * Listeners (and `draggable`) for a channel row; spread with `v-bind`.
   * `expanded`: its subchannels are shown below it, so it has no "after" zone
   * (see dropPositionAt).
   */
  function rowEvents(ch: TsChannel, expanded = false) {
    return {
      draggable: cp.canMove(),
      onDragstart: (ev: DragEvent) => onDragStart(ev, ch),
      onDragover: (ev: DragEvent) => onDragOver(ev, ch.id, !expanded),
      onDragleave: (ev: DragEvent) => onDragLeave(ev, ch.id),
      onDrop: (ev: DragEvent) => onDrop(ev, ch.id, !expanded),
      onDragend: reset,
    };
  }

  /**
   * For rows that take no channel drop (clients): passing over one clears the
   * indicator, which a missed dragleave would otherwise leave on the last channel.
   */
  function otherRowEvents() {
    return {
      onDragover: (ev: DragEvent) => {
        if (isOurs(ev)) over.value = null;
      },
    };
  }

  /** Listeners for the server row: a drop there makes a top-level channel. */
  function serverEvents() {
    return {
      onDragover: (ev: DragEvent) => onDragOver(ev, null),
      onDragleave: (ev: DragEvent) => onDragLeave(ev, null),
      onDrop: (ev: DragEvent) => onDrop(ev, null),
    };
  }

  /** Drop indicator classes for a row (`null` = the server row). */
  function rowClass(id: string | null): Record<string, boolean> {
    const o = over.value;
    const here = !!o && o.id === id;
    return {
      "ch-dragging": id !== null && dragging.value === id,
      "ch-drop-before": here && o.position === "before",
      "ch-drop-inside": here && o.position === "inside",
      "ch-drop-after": here && o.position === "after",
    };
  }

  return { rowEvents, otherRowEvents, serverEvents, rowClass, dragging };
}
