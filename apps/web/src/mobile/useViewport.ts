/**
 * Tells the app which shell to render.
 *
 * One `matchMedia` listener for the whole app, created lazily and never torn
 * down: the breakpoint is global state, and every component that asks gets the
 * same readonly ref rather than its own listener.
 */
import { readonly, ref, type Ref } from "vue";
import { MOBILE_MEDIA_QUERY, isMobileWidth } from "./breakpoint";

const state = ref(false);
let watching = false;

/** Starts the listener on first use; `matchMedia` is missing in unit tests. */
function watch(): void {
  if (watching) return;
  watching = true;
  if (typeof window === "undefined") return;
  if (typeof window.matchMedia !== "function") {
    // No matchMedia (old browser, or a test DOM): read the width once. The
    // shell then stays as it started, which is better than never rendering.
    state.value = isMobileWidth(window.innerWidth);
    return;
  }
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  state.value = query.matches;
  query.addEventListener("change", (e) => (state.value = e.matches));
}

/** `true` while the viewport is narrow enough for the mobile shell. */
export function useViewport(): { isMobile: Readonly<Ref<boolean>> } {
  watch();
  return { isMobile: readonly(state) };
}
