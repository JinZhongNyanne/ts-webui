/**
 * A file card shown as its picture alone — what a small image shared in chat
 * looks like once it has loaded by itself (auto-preview-loader.ts).
 *
 * The name, size and buttons are hidden by CSS rather than removed, so the
 * card is still the card: the image keeps its `data-ft-act="download"` for the
 * day it is shown as a card again (and for the e2e selectors), a click on the
 * picture itself opens the picture viewer instead (chat/richClick.ts), what
 * else it can do — downloading included — is in its menu (card-menu.ts), and a
 * picture the browser cannot decode puts the whole card back untouched.
 *
 * How big a sticker gets is `.bb-sticker-img` in chat/bbcode.css.
 */

/**
 * Shows `url` as `card`'s sticker. Resolves true once the picture is on
 * screen, false when the browser could not decode it (the card is unchanged).
 */
export function showSticker(card: HTMLElement, name: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("span");
    box.className = "bb-file-preview";
    const img = document.createElement("img");
    img.className = "bb-img bb-file-img bb-sticker-img";
    img.alt = name;
    // The name is worth having, but not worth a line of its own next to a sticker.
    img.title = name;
    img.dataset.ftAct = "download";
    img.onload = () => {
      // Only now: until the picture is here, the card must stay readable.
      card.classList.add("sticker");
      resolve(true);
    };
    img.onerror = () => {
      box.remove();
      resolve(false);
    };
    img.src = url;
    box.append(img);
    card.append(box);
  });
}
