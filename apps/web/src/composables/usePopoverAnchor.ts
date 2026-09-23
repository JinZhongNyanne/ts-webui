import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  anchorAbove,
  popoverLimits,
  POPOVER_LAYER,
  type PopoverAlign,
  type Position,
  type ViewportBox,
} from "./popoverPosition";

/** The inline style to put on the teleported panel; nothing else is needed. */
export interface AnchoredPopover {
  readonly style: ComputedRef<Record<string, string>>;
}

export interface AnchorOptions {
  /** Which edge of the popover lines up with the trigger's; see `PopoverAlign`. */
  readonly align?: PopoverAlign;
}

/**
 * The space that is actually on screen, in the coordinates `getBoundingClientRect`
 * and `position: fixed` both use.
 *
 * `window.innerHeight` is the wrong number on a phone: raising the on-screen
 * keyboard leaves it untouched on iOS, so a popover anchored to a chat composer
 * was placed in the half of the page the keyboard had just covered. The visual
 * viewport is the one that shrinks, and its offsets also account for a
 * pinch-zoomed page. Not every browser has it, hence the fallback.
 */
function visibleBox(): ViewportBox {
  const vv = window.visualViewport;
  if (!vv) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
}

/**
 * Keeps a popover that has been teleported to `<body>` sitting on its trigger.
 *
 * Why a frame loop rather than `scroll` and `resize` listeners: the trigger
 * moves for reasons no event tells us about. A dock window is dragged and
 * resized by dockview writing inline styles on its wrapper, a panel's own
 * scroll container fires an event that only capture-phase listeners on
 * `document` would catch, and a phone's keyboard resizes the visual viewport.
 * Reading the trigger's box once a frame while a short-lived popover is open
 * covers all of them with one rule, and the position is only written when it
 * actually changed, so an untouched popover costs one `getBoundingClientRect`
 * per frame and no re-render.
 *
 * Until the first measurement the panel is hidden rather than drawn at the
 * wrong place: `position: fixed` with no offsets would flash it in the corner.
 */
export function usePopoverAnchor(
  trigger: Ref<HTMLElement | null>,
  panel: Ref<HTMLElement | null>,
  open: Ref<boolean>,
  options: AnchorOptions = {},
): AnchoredPopover {
  const at = ref<Position | null>(null);
  /** How large the panel may draw itself; see `popoverLimits`. */
  const limits = ref<{ maxWidth: number; maxHeight: number } | null>(null);
  /** 0 when no frame is pending, which is also how "not following" is read. */
  let frame = 0;

  function measure(): void {
    const anchor = trigger.value?.getBoundingClientRect();
    const box = panel.value?.getBoundingClientRect();
    // Either element can be missing: the panel before it renders, the trigger
    // while its panel is being moved between dock groups.
    if (!anchor || !box) return;
    const viewport = visibleBox();
    const next = anchorAbove(
      anchor,
      { width: box.width, height: box.height },
      viewport,
      options.align ?? "start",
    );
    const now = at.value;
    if (!now || now.left !== next.left || now.top !== next.top) at.value = next;
    const room = popoverLimits(viewport);
    const had = limits.value;
    if (!had || had.maxWidth !== room.maxWidth || had.maxHeight !== room.maxHeight) {
      limits.value = room;
    }
  }

  function follow(): void {
    measure();
    frame = requestAnimationFrame(follow);
  }

  function start(): void {
    if (frame) return;
    // Some test environments have no frame clock; one measurement is still right.
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return;
    }
    follow();
  }

  function stop(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    at.value = null;
    limits.value = null;
  }

  // Post flush: the panel must be in the document before it can be measured.
  watch(open, (isOpen) => (isOpen ? start() : stop()), { flush: "post" });

  onScopeDispose(stop);

  /**
   * The limits go out as custom properties rather than as `max-width` and
   * `max-height`: an inline maximum would override the one a panel sets for
   * itself (a picker that wants 460px, not 60% of a tall screen), where a
   * variable lets it take the smaller of the two — see StickerPicker.vue.
   *
   * Before the first measurement they are `none` rather than zero, because the
   * panel is measured while they are in force: a zero would collapse it and the
   * first frame would be placed for a box of no size.
   */
  const style = computed(() => ({
    position: "fixed",
    left: `${at.value?.left ?? 0}px`,
    top: `${at.value?.top ?? 0}px`,
    "--popover-max-width": limits.value ? `${limits.value.maxWidth}px` : "none",
    "--popover-max-height": limits.value ? `${limits.value.maxHeight}px` : "none",
    zIndex: String(POPOVER_LAYER),
    visibility: at.value ? "visible" : "hidden",
  }));

  return { style };
}
