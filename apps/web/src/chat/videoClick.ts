/**
 * Which click on rendered BBCode opens the video player, kept free of the DOM
 * for the same reason `pictureClick.ts` is: `richClick.ts` reads a handful of
 * facts off the clicked element and asks here.
 *
 * The rule is the picture rule's sibling, and just as narrow. A video poster in
 * chat sits inside a file card that keeps everything it had — its name, its
 * size, its Download button and its Play button — because the card's buttons
 * are the keyboard's way in and the e2e suite's handles. So:
 *
 * - only the `<video>` poster our own player put there (`.bb-video`) counts;
 * - only once it has a frame to show, so a click on an empty box does nothing;
 * - never a press that landed on one of the card's buttons, which were there
 *   first and still download and play;
 * - never the click that follows a held finger on a phone, which belongs to the
 *   menu that press opened.
 *
 * The poster has no `<img>` in it, so the shown-picture menu (`files/card-menu.ts`)
 * does not apply to it and the browser's own menu — "save video as", "copy
 * video address" — is left alone, which is what a plain file card does too.
 */

/** What `richClick.ts` saw at the click. */
export interface ClickedVideo {
  /** The clicked element is a `<video>`. */
  readonly isVideo: boolean;
  /** It carries our poster class (`.bb-video`), so we put it there. */
  readonly isRenderedPoster: boolean;
  /** The poster has its still, so there is a frame to open; it holds no stream by then. */
  readonly hasFrame: boolean;
  /** The press landed on a button — one of the card's actions. */
  readonly onButton: boolean;
  /** The poster's menu is open, and the click after a long press is that menu's. */
  readonly menuOpen: boolean;
}

/** Whether this click should open the player rather than do what it did before. */
export function opensVideoViewer(click: ClickedVideo): boolean {
  return (
    click.isVideo && click.isRenderedPoster && click.hasFrame && !click.onButton && !click.menuOpen
  );
}
