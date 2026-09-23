/**
 * Keyboard plumbing shared by every modal: which element Tab moves to, and
 * which of several stacked dialogs owns the keyboard.
 *
 * The decisions are plain functions over indices and a list, so they can be
 * unit-tested on node; the one DOM-touching helper only gathers the inputs.
 */

/**
 * Everything the browser would put in the Tab order. `[tabindex="-1"]` is
 * reachable by script only, and a disabled control is skipped by the browser
 * too, so neither counts.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(",");

/**
 * Where Tab (or Shift+Tab) should land, given the focusable elements in order.
 *
 * Returns `null` when the browser's own move is already right (somewhere in
 * the middle of the list). `current` is -1 when focus is outside the dialog —
 * which happens after a click on the backdrop or a stray programmatic focus —
 * and is pulled back to the near edge rather than left to escape.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  if (current < 0 || current > last) return backwards ? last : 0;
  if (backwards && current === 0) return last;
  if (!backwards && current === last) return 0;
  return null;
}

/** The dialog's own focusable elements, skipping anything hidden by layout. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    // No layout box means `display: none` somewhere up the chain; the browser
    // would skip it, and focusing it would silently do nothing.
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab inside `root`. Call from a keydown handler; it only acts on Tab
 * and prevents the default move when it wraps focus itself.
 */
export function trapTab(root: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== "Tab") return;
  const items = focusableIn(root);
  if (items.length === 0) {
    // Nothing to move to: keep focus on the dialog itself rather than letting
    // it wander to the page underneath.
    ev.preventDefault();
    root.focus();
    return;
  }
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = nextFocusIndex(items.length, current, ev.shiftKey);
  if (next === null) return;
  ev.preventDefault();
  items[next]!.focus();
}

/**
 * Stack of open modals, newest last. A confirmation can open on top of an
 * editor dialog; only the top one may react to Escape or trap Tab, otherwise
 * one keypress would close both.
 */
export interface ModalStack {
  readonly push: (id: symbol) => void;
  /** Removes `id` wherever it sits; closing out of order is allowed. */
  readonly remove: (id: symbol) => void;
  readonly isTop: (id: symbol) => boolean;
  readonly size: () => number;
}

export function createModalStack(): ModalStack {
  let stack: readonly symbol[] = [];
  return {
    push: (id) => {
      stack = [...stack.filter((s) => s !== id), id];
    },
    remove: (id) => {
      stack = stack.filter((s) => s !== id);
    },
    isTop: (id) => stack.at(-1) === id,
    size: () => stack.length,
  };
}

/** The app-wide stack every `AppDialog` registers with. */
export const modalStack = createModalStack();
