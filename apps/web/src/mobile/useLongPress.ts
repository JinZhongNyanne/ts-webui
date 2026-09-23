/**
 * Turns a held finger into the context menu the desktop opens with a right
 * click.
 *
 * `contextMenu.show()` wants an event it can cancel and read coordinates from,
 * so the touch handlers hand it an adapter with exactly that shape rather than
 * a synthesized DOM event.
 */
import { onUnmounted } from "vue";
import type { MenuAnchorEvent } from "../stores/contextMenu";
import { LONG_PRESS_MS, movedTooFar, type PressPoint } from "./longPress";

/** What a long press hands to the context menu, in place of a right click. */
export type LongPressEvent = MenuAnchorEvent;

/**
 * Handlers to spread onto a row: `v-on="longPress(e => menu(e, channel))"`.
 *
 * The keys are bare event names, because `v-on` with no argument runs them
 * through Vue's `toHandlers`, which adds the `on` prefix itself — an
 * already-prefixed key would end up bound as `onOnTouchstart` and never fire.
 */
export interface LongPressHandlers {
  touchstart(e: TouchEvent): void;
  touchmove(e: TouchEvent): void;
  touchend(): void;
  touchcancel(): void;
}

/**
 * Builds touch handlers that call `onPress` once the finger has rested in
 * place. A scroll, a lifted finger or an unmount cancels the pending press.
 */
export function useLongPress(): (onPress: (e: LongPressEvent) => void) => LongPressHandlers {
  let timer: number | null = null;
  let start: PressPoint | null = null;

  function cancel(): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    start = null;
  }

  onUnmounted(cancel);

  return (onPress) => ({
    touchstart(e) {
      // A second finger means a pinch or a scroll, never a press.
      if (e.touches.length !== 1) return cancel();
      const touch = e.touches[0]!;
      cancel();
      start = { x: touch.clientX, y: touch.clientY };
      timer = window.setTimeout(() => {
        const at = start;
        cancel();
        if (!at) return;
        onPress({
          clientX: at.x,
          clientY: at.y,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        });
      }, LONG_PRESS_MS);
    },
    touchmove(e) {
      const touch = e.touches[0];
      if (!start || !touch) return;
      if (movedTooFar(start, { x: touch.clientX, y: touch.clientY })) cancel();
    },
    touchend: cancel,
    touchcancel: cancel,
  });
}
