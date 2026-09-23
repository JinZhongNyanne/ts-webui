/* eslint-disable @typescript-eslint/no-explicit-any */
import { usableDesktop, type Box, type DesktopSize } from "./box";

/**
 * The only file that reaches past `DockviewApi`.
 *
 * A Windows-style desktop needs four things dockview keeps to itself: a
 * floating window's box, a call that moves *and* resizes one, the event that
 * fires when a float's drag ends, and — for the snap group — the per-frame event
 * that fires while one is being resized, plus the overlay element that says
 * which window a pressed resize handle belongs to. `group.api.setSize` resizes but cannot
 * move; `group.api.maximize()` returns immediately for a float; re-adding the
 * group as a floating group would tear down and rebuild its DOM, reloading
 * every iframe and video inside it. So we use `component.floatingGroups`, which
 * is TypeScript-private but a real runtime field.
 *
 * Everything here is shape-checked and returns a failure instead of throwing:
 * a dockview upgrade that moves these leaves the desktop with plain floating
 * windows (no snap, no maximise) rather than a broken client.
 */

export interface FloatingWindows {
  /**
   * The window's current box, or `null` if it is not a float we can read.
   *
   * A right/bottom anchor is resolved against `container` when given, and
   * against the live container otherwise. The desktop's resize handling
   * passes the size from *before* the resize: the anchor offsets have not
   * changed, but the live container already has.
   */
  boxOf(group: unknown, container?: DesktopSize): Box | null;
  /** Moves and resizes the window. Returns false when it could not be done. */
  position(group: unknown, box: Box): boolean;
  /** Fires when a float's drag ends — also after a *resize* drag, so gate on intent. */
  onDragEnd(handler: (group: unknown) => void): { dispose(): void };
  /**
   * Fires on every frame in which that window's box changes — a move or a
   * resize. Subscribe for the duration of one gesture and dispose after it.
   */
  onChange(group: unknown, handler: () => void): { dispose(): void };
  /**
   * The floating window whose overlay contains that element, or `null`.
   *
   * How a pressed resize handle is traced back to the window it belongs to:
   * the handles are children of the overlay element, and the overlay is the one
   * thing `floatingGroups` gives us that is also in the DOM.
   */
  groupOfElement(element: unknown): unknown | null;
  /** False when dockview no longer exposes what we need. */
  readonly available: boolean;
}

const UNAVAILABLE: FloatingWindows = {
  available: false,
  boxOf: () => null,
  position: () => false,
  onDragEnd: () => ({ dispose: () => void 0 }),
  onChange: () => ({ dispose: () => void 0 }),
  groupOfElement: () => null,
};

interface FloatEntry {
  readonly group: unknown;
  position(bounds: { top: number; left: number; width: number; height: number }): void;
  readonly overlay: {
    toJSON(): unknown;
    readonly element?: unknown;
    /** `Overlay.onDidChange`, public in dockview but not on `DockviewApi`. */
    onDidChange?: (handler: () => void) => { dispose?: () => void } | undefined;
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The size of the element dockview positions its floating windows inside.
 *
 * `Overlay` appends its `.dv-resize-container` to the container it was given
 * and measures both against `getBoundingClientRect`, so the overlay element's
 * parent *is* that container — which is why this is read from the live DOM
 * rather than from `.dock`: an anchored box must be resolved against exactly
 * the box dockview anchored it to, not a second measurement of a cousin
 * element that only happens to agree today.
 */
function containerSizeOf(entry: FloatEntry): DesktopSize | null {
  const parent = (entry.overlay?.element as { parentElement?: unknown } | undefined)?.parentElement;
  const rect = parent as { getBoundingClientRect?: () => unknown } | null | undefined;
  if (typeof rect?.getBoundingClientRect !== "function") return null;
  try {
    const box = rect.getBoundingClientRect() as { width?: unknown; height?: unknown };
    const width = num(box?.width);
    const height = num(box?.height);
    if (width === null || height === null) return null;
    return usableDesktop(width, height);
  } catch {
    return null;
  }
}

/**
 * One axis of dockview's anchored box, as an offset from the top-left corner.
 *
 * `Overlay.toJSON()` emits whichever edge it is currently anchored to, and its
 * drag and resize handlers re-anchor to the *nearer* edge on every gesture
 * (`if (top <= bottom) bounds.top = top; else bounds.bottom = bottom`). So a
 * window dragged into the right-hand or lower part of the desktop comes back
 * as `right` / `bottom`, and reading only `left` / `top` would lose it.
 */
function offsetFrom(
  near: number | null,
  far: number | null,
  extent: number,
  available: number | null,
): number | null {
  if (near !== null) return near;
  if (far === null || available === null) return null;
  return available - far - extent;
}

/** dockview's overlay serialises as an anchored box; we speak top-left only. */
function boxFrom(raw: unknown, container: () => DesktopSize | null): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const width = num(b.width);
  const height = num(b.height);
  if (width === null || height === null) return null;
  const left = num(b.left);
  const top = num(b.top);
  // Only measure the container when an anchor actually needs resolving.
  const size = left === null || top === null ? container() : null;
  const x = offsetFrom(left, num(b.right), width, size?.width ?? null);
  const y = offsetFrom(top, num(b.bottom), height, size?.height ?? null);
  if (x === null || y === null) return null;
  return { x, y, width, height };
}

/**
 * The eight elements `Overlay.setupResize` appends inside its container.
 *
 * Matched on the class *prefix* rather than the eight names, so the selector
 * and `snapGroup.ts`'s `resizeEdgesOf` cannot drift apart: this decides
 * "a resize was pressed", that one decides "which edges", and an unrecognised
 * direction is then handled in one place instead of silently not matching here.
 */
export const RESIZE_HANDLE_SELECTOR = '[class*="dv-resize-handle-"]';

/** The element `Overlay` puts round one floating window. */
const OVERLAY_SELECTOR = ".dv-resize-container";

/** The floating-window operations of a live dockview, or a no-op stand-in. */
export function floatingWindows(api: unknown): FloatingWindows {
  const component = (api as any)?.component;
  const groups = component?.floatingGroups;
  if (!component || !Array.isArray(groups)) return UNAVAILABLE;
  if (typeof component.onDidEndFloatingGroupDrag !== "function") return UNAVAILABLE;

  const entryFor = (group: unknown): FloatEntry | null =>
    (component.floatingGroups as FloatEntry[]).find((f) => f?.group === group) ?? null;

  return {
    available: true,
    boxOf(group, container) {
      const entry = entryFor(group);
      if (!entry || typeof entry.overlay?.toJSON !== "function") return null;
      try {
        return boxFrom(entry.overlay.toJSON(), () => container ?? containerSizeOf(entry));
      } catch {
        return null;
      }
    },
    position(group, box) {
      const entry = entryFor(group);
      if (!entry || typeof entry.position !== "function") return false;
      try {
        // One anchor per axis, and always the top-left pair. `Overlay.setBounds`
        // re-anchors each axis to whichever edge it is handed — `top` sets the
        // vertical anchor to the top and `bottom` to the bottom, and whichever
        // came last wins — so naming `top` and `left` here puts a window that had
        // flipped to `right`/`bottom` (its drag and resize handlers re-anchor to
        // the nearer edge) back on the corner every box in this file is measured
        // from. Handing it a mixed pair, or only one of the two, would leave the
        // other axis anchored to the far edge and a later restore would drift.
        entry.position({ top: box.y, left: box.x, width: box.width, height: box.height });
        return true;
      } catch {
        return false;
      }
    },
    onChange(group, handler) {
      const entry = entryFor(group);
      if (typeof entry?.overlay?.onDidChange !== "function") {
        // dockview stopped exposing the per-frame event: the caller gets a
        // subscription that never fires, which turns its feature off.
        return { dispose: () => void 0 };
      }
      try {
        const sub = entry.overlay.onDidChange(handler);
        return { dispose: () => sub?.dispose?.() };
      } catch {
        return { dispose: () => void 0 };
      }
    },
    groupOfElement(element) {
      const node = element as { closest?: (selector: string) => unknown } | null | undefined;
      if (typeof node?.closest !== "function") return null;
      try {
        const overlay = node.closest(OVERLAY_SELECTOR);
        if (!overlay) return null;
        return (
          (component.floatingGroups as FloatEntry[]).find((f) => f?.overlay?.element === overlay)
            ?.group ?? null
        );
      } catch {
        return null;
      }
    },
    onDragEnd(handler) {
      try {
        const sub = component.onDidEndFloatingGroupDrag(handler);
        return { dispose: () => sub?.dispose?.() };
      } catch {
        return { dispose: () => void 0 };
      }
    },
  };
}

/**
 * The element dockview wraps a floating window in.
 *
 * Minimising toggles a class on it. It is deliberately not `setVisible(false)`:
 * that sets `display: none`, after which dockview re-clamps the window from its
 * now-zero bounding box on the next layout — parking it off-screen — and
 * serialises it as 0x0.
 */
export function overlayElementOf(group: { element?: unknown }): HTMLElement | null {
  const element = group?.element;
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return null;
  return element.closest<HTMLElement>(".dv-resize-container");
}

/**
 * The element a panel's content is rendered into under `defaultRenderer: 'always'`.
 *
 * With `always`, dockview does *not* keep a panel's content inside its group.
 * It appends it to one shared container on the dock's shell
 * (`OverlayRenderContainer`, rooted on the shell element) and positions that
 * `.dv-render-overlay` over the group frame every frame. That is precisely what
 * makes a tab survive being stacked and torn out — nothing is ever reparented
 * or rebuilt — and it is also why hiding the group's own `.dv-resize-container`
 * is no longer enough to hide a window: the content is not inside it, and a
 * minimised window would go on floating over the empty desktop.
 *
 * So minimising has to reach the content overlay too. dockview sets
 * `visibility` and `pointer-events` *inline* on this element, which would beat
 * a class; `opacity` it never touches, which is why the minimised class hides
 * with opacity (see `desktop.css`).
 */
export function contentOverlayOf(panel: unknown): HTMLElement | null {
  const element = (panel as any)?.view?.content?.element;
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return null;
  return element.closest<HTMLElement>(".dv-render-overlay");
}

/**
 * The element dockview positions floating windows inside, under the dock's root.
 *
 * It is not simply the root: dockview gives it an explicit pixel size from its
 * own layout pass, which runs a frame after the root has already resized, and
 * clamps every window against it in that same pass. Anything that moves
 * windows because the desktop resized has to wait for *this* element. `null`
 * when a dockview upgrade renames it; the caller falls back to the root.
 */
export function floatingHostOf(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".dv-floating-overlay-host");
}
