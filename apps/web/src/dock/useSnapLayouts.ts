import { onBeforeUnmount, shallowRef, type ShallowRef } from "vue";
import type { DockviewApi } from "dockview-vue";
import { clampNumber } from "./box";
import { layoutZoneBoxFor, SNAP_LAYOUTS } from "./layouts";
import { PANEL_TESTID } from "./snapLayoutTile";
import type { Desktop } from "./useDesktop";

/**
 * The hover half of Snap Layouts: resting the pointer on a window's maximise
 * button drops the flyout just under that window's titlebar.
 *
 * Everything DOM-ish about that trigger lives here so `App.vue` keeps only the
 * shell. The *drop* half of the feature (dragging a window to the top edge)
 * belongs to the drag itself and lives in `useDesktop.ts`.
 */

/** One thumbnail's box in the flyout, and the gaps around them. */
const TILE_WIDTH = 92;
const TILE_GAP = 10;
const PANEL_PADDING = 10;

/**
 * The flyout's width, which is fixed because its contents are.
 *
 * Exported so both the component that draws it and the clamp that keeps it
 * inside the desktop work from the same number rather than two guesses.
 */
export const PANEL_WIDTH =
  SNAP_LAYOUTS.length * TILE_WIDTH + (SNAP_LAYOUTS.length - 1) * TILE_GAP + 2 * PANEL_PADDING;

/** How far the flyout is kept from the edges of the desktop. */
const PANEL_MARGIN = 8;

/** The gap between the maximise button and the top of the flyout. */
const BUTTON_GAP = 6;

/**
 * How long the pointer has to rest on the maximise button before the flyout
 * opens. Windows waits too: opening the instant the pointer crosses the button
 * would flash the panel at anyone merely sweeping across the titlebar.
 */
const OPEN_DELAY_MS = 320;

/**
 * The grace period before a flyout that nothing is hovering closes.
 *
 * Long enough to cross the gap between the button and the panel, which is
 * empty space that belongs to neither and would otherwise close it mid-reach.
 */
const CLOSE_DELAY_MS = 260;

/** Where an open flyout sits, and which window it will act on. */
export interface LayoutsAnchor {
  readonly panelId: string;
  /** Relative to the desktop wrapper, which is what the flyout is placed in. */
  readonly left: number;
  readonly top: number;
}

export interface SnapLayoutsUi {
  /** The open hover flyout, or `null` when none is open. */
  readonly anchor: ShallowRef<LayoutsAnchor | null>;
  /**
   * Wires the hover trigger onto the desktop wrapper.
   *
   * `resolvePanel` is how the clicked-or-hovered window is identified; see
   * `App.vue`'s `controlTarget`, which walks up to the group's own element
   * rather than trusting `api.activePanel`.
   */
  install(
    api: DockviewApi,
    wrap: HTMLElement,
    resolvePanel: (button: HTMLElement) => string | undefined,
  ): void;
  close(): void;
  /** The panel itself is hovered: cancel the pending close. */
  hold(): void;
  /** The pointer left the panel: start the grace period. */
  release(): void;
  /** Puts the window this flyout belongs to into that zone, and closes. */
  pick(layoutId: string, zoneId: string): void;
}

export function useSnapLayouts(desktop: Desktop): SnapLayoutsUi {
  const anchor = shallowRef<LayoutsAnchor | null>(null);
  let openTimer: number | null = null;
  let closeTimer: number | null = null;
  /** Undone on unmount; the desktop outlives individual windows, not the app. */
  const teardown: (() => void)[] = [];

  function cancelTimers(): void {
    if (openTimer !== null) window.clearTimeout(openTimer);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  }

  function close(): void {
    cancelTimers();
    anchor.value = null;
  }

  function hold(): void {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
  }

  function release(): void {
    hold();
    closeTimer = window.setTimeout(close, CLOSE_DELAY_MS);
  }

  /**
   * Where the flyout goes for a maximise button: under the window's titlebar,
   * centred on the window, and never hanging off the desktop.
   *
   * `.dock-wrap` clips what overflows it, so a window near the right edge has
   * to have its flyout pulled back inside rather than cut in half.
   */
  function anchorFor(button: HTMLElement, wrap: HTMLElement, panelId: string): LayoutsAnchor {
    const wrapBox = wrap.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const group = button.closest(".dv-groupview");
    const groupBox = group?.getBoundingClientRect() ?? buttonBox;
    const centre = groupBox.left + groupBox.width / 2 - wrapBox.left;
    return {
      panelId,
      left: clampNumber(
        Math.round(centre - PANEL_WIDTH / 2),
        PANEL_MARGIN,
        Math.max(PANEL_MARGIN, wrapBox.width - PANEL_WIDTH - PANEL_MARGIN),
      ),
      top: Math.round(buttonBox.bottom - wrapBox.top + BUTTON_GAP),
    };
  }

  function install(
    api: DockviewApi,
    wrap: HTMLElement,
    resolvePanel: (button: HTMLElement) => string | undefined,
  ): void {
    /**
     * One delegated listener covers both halves of the hover target: the
     * maximise buttons, which dockview builds itself and so cannot be bound in
     * a template, and the flyout, which is a sibling of the dock inside the
     * same wrapper. Anything else under the pointer means neither is hovered.
     */
    const onOver = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[data-testid=${PANEL_TESTID}]`)) {
        hold();
        return;
      }
      const button = target?.closest<HTMLElement>("[data-testid=dock-maximize]");
      if (!button) {
        if (anchor.value) release();
        else cancelTimers();
        return;
      }
      hold();
      const panelId = resolvePanel(button);
      if (!panelId) return;
      // Already open for this window: leave it where it is rather than
      // re-anchoring it under a pointer that only jittered.
      if (anchor.value?.panelId === panelId) return;
      if (openTimer !== null) window.clearTimeout(openTimer);
      openTimer = window.setTimeout(() => {
        openTimer = null;
        anchor.value = anchorFor(button, wrap, panelId);
      }, OPEN_DELAY_MS);
    };

    const onLeave = (): void => {
      if (anchor.value) release();
      else cancelTimers();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && anchor.value) close();
    };

    wrap.addEventListener("mouseover", onOver);
    wrap.addEventListener("mouseleave", onLeave);
    document.addEventListener("keydown", onKeyDown);
    teardown.push(() => {
      wrap.removeEventListener("mouseover", onOver);
      wrap.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("keydown", onKeyDown);
    });

    // A flyout outlives its window otherwise: close it, close the tab, and the
    // panel would still be offering to snap a window that no longer exists.
    const sub = api.onDidRemovePanel((removed) => {
      if (anchor.value?.panelId === removed.id) close();
    });
    teardown.push(() => sub.dispose());
  }

  function pick(layoutId: string, zoneId: string): void {
    const panelId = anchor.value?.panelId;
    const size = desktop.desktopSize();
    close();
    if (!panelId || !size) return;
    const box = layoutZoneBoxFor(layoutId, zoneId, size);
    if (box) desktop.snapTo(panelId, box);
  }

  onBeforeUnmount(() => {
    cancelTimers();
    for (const undo of teardown.splice(0)) undo();
  });

  return { anchor, install, close, hold, release, pick };
}
