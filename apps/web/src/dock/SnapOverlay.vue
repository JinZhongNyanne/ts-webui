<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { Box } from "./box";
import { DWELL_MS } from "./snapDwell";
import type { SnapDwelling } from "./snapFeedback";

/**
 * The two rectangles that tell the user what a drag would do.
 *
 * Every snap on this desktop waits out half a second of rest before it arms
 * (`snapDwell.ts`), and the feedback has to admit that, because for that half
 * second a release does *nothing*. So there are two states, and they are drawn
 * to be unmistakable for one another:
 *
 * - **`dwelling`** — a dashed, hollow outline of the box, whose translucent fill
 *   climbs from bottom to top over exactly the dwell. "This is the box; keep
 *   holding, and here is how much longer." Windows 11 shows the wait in much the
 *   same way, and it matters here for the same reason: a wait the user cannot
 *   see the end of is a wait they abandon.
 * - **`box`** — the solid preview. "Let go and this happens", which is now true
 *   the whole time it is on screen. It used to be the only rectangle, which left
 *   the half second to dockview's own instant edge highlight — full strength
 *   from the first frame, and a lie for the next 500ms. That highlight is now
 *   off; see `dropOverlay.css`.
 *
 * Both are painted from the same box (see `snapFeedback.ts`), so the outline
 * firming into the preview reads as one promise being made rather than two
 * different offers.
 *
 * The armed preview also moves the way Windows 11's does, and the motion is not
 * decoration: it is what tells the user the rectangle is *one* promise being
 * revised rather than a series of unrelated flashes.
 *
 * - It fades and grows in from 96% of its size, so it reads as arriving rather
 *   than being stamped on the wallpaper.
 * - **The glide is the important one.** `box` changes while the rectangle stays
 *   on screen — the drag crosses from one zone to the next (which the dwell now
 *   arms at once, see `snapDwell.ts`), or a gap-fill preview tracks the pointer
 *   frame by frame. Transitioning `left`/`top`/`width`/`height` makes those
 *   changes a single rectangle sliding and stretching to its new place; without
 *   it the same sequence is a rectangle vanishing here and a different one
 *   appearing there, and the user has to work out that they meant the same
 *   thing.
 * - It leaves quickly, because a promise being withdrawn should not linger.
 *
 * The timings and easings live in `desktop.css` as custom properties;
 * `@media (prefers-reduced-motion: reduce)` turns the movement off — including
 * the climbing fill — and keeps the hollow-versus-solid distinction, which is
 * the honest part and costs no motion at all.
 *
 * `<Transition>`s — rather than always-mounted elements faded to nothing —
 * because the elements' *presence* is the contract the e2e specs read: they wait
 * for `snap-preview` to be visible and then release, and one spec asserts it is
 * absent when nothing armed. Playwright ignores `opacity`, so a permanently
 * mounted rectangle would look armed at every moment of every drag. For the same
 * reason the pre-arm outline is a *different* element with a *different* testid
 * (`snap-dwell`): `snap-preview` goes on meaning "armed, release commits it".
 */
const props = defineProps<{ box: Box | null; dwelling: SnapDwelling | null }>();

/**
 * The last box the preview was armed with, kept for the leave.
 *
 * While the rectangle is fading out, `box` is already `null` — nothing is armed
 * any more — but the element is still on screen and still needs somewhere to be.
 * Reading the position from the remembered box keeps it where it was instead of
 * collapsing into the top-left corner on its way out.
 */
const shown = shallowRef<Box | null>(props.box);
watch(
  () => props.box,
  (box) => {
    if (box) shown.value = box;
  },
);

/** A box as the four properties that place an absolutely positioned element. */
const place = (box: Box) => ({
  left: `${box.x}px`,
  top: `${box.y}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
});

const style = computed(() => (shown.value ? place(shown.value) : undefined));

/**
 * The outline's geometry, and the one number its fill is timed by.
 *
 * The dwell's length is handed to CSS rather than duplicated in it, so the fill
 * finishes when the wait does by construction and cannot drift out of step with
 * `DWELL_MS`. The fill is a CSS animation rather than a fraction computed per
 * frame because a drag held perfectly still — the very gesture the wait is
 * there to recognise — produces no frames at all.
 */
const dwellStyle = computed(() =>
  props.dwelling ? { ...place(props.dwelling.box), "--snap-dwell-ms": `${DWELL_MS}ms` } : undefined,
);
</script>

<template>
  <!--
    Keyed on when the wait started, so a wait that re-anchors — the drag drifted
    further than `DWELL_TOLERANCE` and the clock started over — remounts the
    element and restarts its fill from empty. Without the key the fill would run
    on and claim the half second was nearly up when it had just begun again.
  -->
  <Transition name="snap-dwell">
    <div
      v-if="dwelling"
      :key="dwelling.since"
      class="snap-dwell"
      data-testid="snap-dwell"
      :style="dwellStyle"
      aria-hidden="true"
    />
  </Transition>
  <Transition name="snap-preview">
    <div
      v-if="box"
      class="snap-preview"
      data-testid="snap-preview"
      :style="style"
      aria-hidden="true"
    />
  </Transition>
</template>
