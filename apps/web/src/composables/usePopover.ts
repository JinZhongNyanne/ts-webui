import { onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  containsAny,
  createPopoverRegistry,
  keyDismisses,
  pointerDismisses,
  type ContainsTarget,
} from "./popover-core";
import { usePopoverAnchor, type AnchorOptions } from "./usePopoverAnchor";

export interface Popover {
  readonly open: Ref<boolean>;
  readonly toggle: () => void;
  readonly close: () => void;
  /**
   * Bind this to the teleported panel: it is what gets measured, and a press
   * inside it counts as inside the popover rather than outside.
   */
  readonly panel: Ref<HTMLElement | null>;
  /** Fixed-position style for the teleported panel, anchored on the trigger. */
  readonly style: ComputedRef<Record<string, string>>;
}

/** "Is the event target inside this element?", for one of the popover's boxes. */
const holds =
  (el: Ref<HTMLElement | null>): ContainsTarget =>
  (target) =>
    target instanceof Node && (el.value?.contains(target) ?? false);

/** One registry for the whole app: opening any popover closes the others. */
const registry = createPopoverRegistry();

/**
 * Open/close state and placement for a popover whose trigger lives at `root`.
 *
 * While open, a pointerdown outside the popover or an Escape keypress closes
 * it, and opening another `usePopover` instance closes this one. Document
 * listeners exist only while open and are dropped when the owning scope ends.
 *
 * The panel itself is teleported to `<body>` (see `usePopoverAnchor`), so
 * "outside" cannot be read from the trigger's subtree alone: it is a press in
 * neither the trigger nor the panel. That also settles following a dragged
 * dock window for free — a drag begins with a press on the window's title bar,
 * which is outside both boxes and therefore dismisses the popover anyway.
 */
export function usePopover(root: Ref<HTMLElement | null>, options: AnchorOptions = {}): Popover {
  const open = ref(false);
  const panel = ref<HTMLElement | null>(null);
  const { style } = usePopoverAnchor(root, panel, open, options);

  const contains = containsAny([holds(root), holds(panel)]);

  const onPointerDown = (ev: PointerEvent): void => {
    if (pointerDismisses(ev.target, contains)) close();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (keyDismisses(ev.key)) close();
  };

  const attach = (): void => {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
  };
  const detach = (): void => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  };

  function close(): void {
    open.value = false;
  }
  function toggle(): void {
    open.value = !open.value;
  }

  // Sync flush so listeners and registry track `open` before the next event.
  watch(
    open,
    (isOpen) => {
      if (isOpen) {
        registry.activate(close);
        attach();
      } else {
        registry.release(close);
        detach();
      }
    },
    { flush: "sync" },
  );

  onScopeDispose(() => {
    registry.release(close);
    detach();
  });

  return { open, toggle, close, panel, style };
}
