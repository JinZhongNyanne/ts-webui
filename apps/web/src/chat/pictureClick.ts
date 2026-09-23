/**
 * Which click on rendered BBCode opens the picture viewer, and what to call
 * the picture it opens. Kept free of the DOM so the rule itself can be tested:
 * `richClick.ts` reads the three or four facts below off the clicked element
 * and asks here.
 *
 * The rule has to be narrow, because a picture in chat sits in the middle of
 * other clickable things that were there first and must keep working:
 *
 * - the click-to-load placeholder of an external image (`.bb-img-ph`) loads
 *   that image, or its whole host, and there is no picture to view yet;
 * - a file card's buttons download or preview the file;
 * - a held finger opens the picture's menu, and the click that follows it on a
 *   phone belongs to that menu, not to the viewer;
 * - a picture shown in place of a card still carries `data-ft-act="download"`
 *   for the e2e selectors and for the day it is not shown, so "has a file
 *   action" cannot be what decides — being the `<img>` itself is.
 *
 * Everything else (a link, a client mention, plain text) is somebody else's
 * click and is left untouched.
 */

/** What `richClick.ts` saw at the click. */
export interface ClickedPicture {
  /** The clicked element is an `<img>`. */
  readonly isImage: boolean;
  /** It carries our renderer's picture class (`.bb-img`). */
  readonly isRenderedPicture: boolean;
  /** The browser has decoded it (a natural size), so there is something to show. */
  readonly decoded: boolean;
  /** It sits inside the click-to-load placeholder for an external host. */
  readonly inPlaceholder: boolean;
  /** The press landed on a button — the placeholder's, or a card's action. */
  readonly onButton: boolean;
  /**
   * The picture's own menu is open. A held finger on a phone opens that menu
   * and *still* ends in a `click`, which would otherwise open the viewer
   * underneath the menu the user just asked for.
   */
  readonly menuOpen: boolean;
}

/** Whether this click should open the viewer rather than do what it did before. */
export function opensPictureViewer(click: ClickedPicture): boolean {
  return (
    click.isImage &&
    click.isRenderedPicture &&
    click.decoded &&
    !click.inPlaceholder &&
    !click.onButton &&
    !click.menuOpen
  );
}

/** The attributes of the clicked picture the viewer needs for its title. */
export interface PictureAttributes {
  readonly alt: string;
  readonly title: string;
  readonly src: string;
}

/**
 * What to call the picture. A file card names it (`alt` and `title`, see
 * `files/sticker.ts`); an `[img]` tag has no name at all, so the last segment
 * of its address is the best that is honestly available — and an address that
 * says nothing gives an empty name rather than a guess, which the viewer shows
 * as no title instead of as `blob:`.
 */
export function pictureNameOf(img: PictureAttributes): string {
  const named = img.alt.trim() || img.title.trim();
  if (named) return named;
  const path = img.src.split(/[?#]/, 1)[0] ?? "";
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    // A stray percent in the address is not worth failing over.
    return last;
  }
}
