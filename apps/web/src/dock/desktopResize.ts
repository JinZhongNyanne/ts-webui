import type { DockviewApi } from "dockview-vue";
import { usableDesktop, type Box, type DesktopSize } from "./box";
import { floatingHostOf, floatingWindows } from "./dockviewInternals";
import { refitBoxes } from "./refit";

/**
 * Keeps every window in the same place relative to the desktop when the
 * desktop changes size; the rule itself is `refitBoxes`.
 *
 * The timing is the whole difficulty. dockview resizes its floating-window
 * host and clamps every window into it in one synchronous pass, from a
 * `requestAnimationFrame` a frame after the viewport changed. So:
 *
 * - The boxes are *read* on the browser's `resize` event, which is dispatched
 *   before any animation frame — before dockview has clamped anything. Read
 *   any later and a window snapped to the right half of a shrinking desktop
 *   has already been shoved inwards, and no longer looks snapped.
 * - They are *written* when the host itself reports its new size, which is
 *   after that pass. Written any earlier, a window moved outwards on a growing
 *   desktop is clamped back against the host's old, smaller size.
 *
 * A host resize that no `resize` event announced (the desktop changing size in
 * a viewport that did not) reads the boxes then, as well as it can.
 *
 * Returns the function that stops watching.
 */
export function watchDesktopResize(
  live: DockviewApi,
  root: HTMLElement,
  onRefit: (from: DesktopSize, to: DesktopSize) => void,
): () => void {
  if (typeof ResizeObserver === "undefined") return () => void 0;
  const windows = floatingWindows(live);
  const host = floatingHostOf(root) ?? root;

  const measure = (): DesktopSize | null => {
    const rect = host.getBoundingClientRect();
    return usableDesktop(rect.width, rect.height);
  };
  const boxesAt = (size: DesktopSize): Map<unknown, Box> => {
    const boxes = new Map<unknown, Box>();
    for (const panel of live.panels) {
      const group = panel.group;
      if (!group || boxes.has(group)) continue;
      const box = windows.boxOf(group, size);
      if (box) boxes.set(group, box);
    }
    return boxes;
  };

  /** The size the windows were last placed against. */
  let placed = measure();
  /** The boxes read at the `resize` event, waiting for the host to follow. */
  let pending: Map<unknown, Box> | null = null;

  const onViewportResize = (): void => {
    // Only while the host still has the size the windows were placed against:
    // once it has changed, dockview may already have clamped them.
    const now = measure();
    if (placed && now && sameSize(now, placed)) pending = boxesAt(placed);
  };

  const onHostResize = (): void => {
    const to = measure();
    // Hidden or detached: keep the old size, so the next real size is
    // refitted from where the windows actually are.
    if (!to) return;
    const from = placed;
    const boxes = pending;
    placed = to;
    pending = null;
    if (!from || sameSize(from, to)) return;
    // As a set: whether a window's edge is held in place by a neighbour is
    // part of the rule.
    const entries = [...(boxes ?? boxesAt(from))];
    const moved = refitBoxes(
      entries.map(([, box]) => box),
      from,
      to,
    );
    entries.forEach(([group], i) => {
      const box = moved[i];
      if (box) windows.position(group, box);
    });
    onRefit(from, to);
  };

  const observer = new ResizeObserver(onHostResize);
  observer.observe(host);
  window.addEventListener("resize", onViewportResize);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onViewportResize);
  };
}

function sameSize(a: DesktopSize, b: DesktopSize): boolean {
  return a.width === b.width && a.height === b.height;
}
