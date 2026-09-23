/**
 * Clicks inside rendered BBCode (`v-html`), handled by delegation on the
 * container: the HTML is a string, so it cannot carry Vue listeners.
 *
 * - a picture already shown (an `[img]` tag, or a file card that became its
 *   own picture): open it in the picture viewer, magnified or shrunk there
 *   rather than downloaded (components/viewer, chat/pictureClick.ts). It is
 *   handed the address the message is already showing, so nothing is fetched
 *   that the message did not fetch itself;
 * - a video poster already under a card: open it in the player, paused on its
 *   first frame, on the address the card already has (components/viewer,
 *   chat/videoClick.ts). Nothing is fetched a second time — unless that
 *   address is a media link that has expired or is about to, when the click
 *   does what the card's Play button does and mints a fresh one
 *   (files/video-source.ts);
 * - image placeholders: load this image, or always load from its host;
 * - file cards (`ts3file://` links): download, preview an image, or play a
 *   video (chat/files/card-actions.ts);
 * - `client://` links: select that user (found by UID first — a link from the
 *   history names a client id that may belong to someone else by now);
 * - `channelid://` links: select that channel.
 *
 * A picture shown in chat has no buttons left (chat/files/sticker.ts), so it
 * carries a menu instead: the right button here, a held finger through
 * `onRichLongPress`. What is in it is chat/files/card-menu.ts's.
 */
import { ftNameOf } from "@jinz/protocol";
import { safeHttpUrl, imageTag } from "../ts/bbcode";
import { t } from "../i18n";
import { useTsStore } from "../stores/ts";
import { useChatSettingsStore } from "../stores/chatSettings";
import { useContextMenu, type MenuAnchorEvent } from "../stores/contextMenu";
import { onFileCardAction, type CardAction } from "./files/card-actions";
// Registers "add to stickers" on a shown picture (see files/card-menu.ts).
import "../stickers/card-action";
import { readCard } from "./files/card";
import { cardMenuItems } from "./files/card-menu";
import { opensPictureViewer, pictureNameOf } from "./pictureClick";
import { opensVideoViewer } from "./videoClick";
import { keptVideoLink } from "./files/videos";
import { planPosterClick } from "./files/video-source";
import { POSTER_URL_ATTR } from "./files/video-poster";
import { openPictureViewer, openVideoViewer } from "../components/viewer/media-viewer";

export function onRichClick(ev: MouseEvent): void {
  const target = ev.target instanceof Element ? ev.target : null;
  if (!target) return;

  // Before everything else, and narrowly: only the picture itself, never a
  // button over it and never the placeholder that has yet to load one, so the
  // clicks that were here first (below) all still do what they did.
  if (target instanceof HTMLImageElement && viewPicture(target)) {
    ev.preventDefault();
    return;
  }

  // The same, narrowly, for a video poster: the card's own buttons (below) are
  // untouched, and only the poster itself opens the player.
  if (target instanceof HTMLVideoElement && playVideo(target)) {
    ev.preventDefault();
    return;
  }

  const action = target.closest<HTMLElement>("[data-bb-act]");
  const placeholder = action?.closest<HTMLElement>(".bb-img-ph");
  if (action && placeholder) {
    ev.preventDefault();
    ev.stopPropagation();
    loadPlaceholder(placeholder, action.dataset.bbAct === "always");
    return;
  }

  const fileAction = target.closest<HTMLElement>("[data-ft-act]");
  const card = fileAction?.closest<HTMLElement>(".bb-file");
  if (fileAction && card) {
    ev.preventDefault();
    ev.stopPropagation();
    void onFileCardAction(card, cardActionOf(fileAction.dataset.ftAct));
    return;
  }

  const client = target.closest<HTMLElement>("a.bb-client");
  if (client) {
    ev.preventDefault();
    selectClient(Number(client.dataset.clid), client.dataset.uid);
    return;
  }

  const channel = target.closest<HTMLElement>("a.bb-channel");
  if (channel) {
    ev.preventDefault();
    selectChannel(channel.dataset.cid ?? "");
  }
}

/** The right button on a picture shown in chat. */
export function onRichContextMenu(ev: MouseEvent): void {
  if (ev.target instanceof Element) openCardMenu(ev.target, ev);
}

/**
 * The same menu from a held finger (mobile/useLongPress.ts). A touch carries
 * no target, so the picture is the one under the finger.
 */
export function onRichLongPress(ev: MenuAnchorEvent): void {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (el) openCardMenu(el, ev);
}

function openCardMenu(el: Element, anchor: MenuAnchorEvent): void {
  const card = el.closest<HTMLElement>(".bb-file");
  const img = card?.querySelector<HTMLImageElement>(".bb-file-preview img");
  // Only a picture that is actually shown has a menu: a plain file card still
  // has its buttons, and everything else keeps the browser's own menu.
  if (!card || !img) return;
  const file = readCard(card.dataset);
  if (!file) return;
  const name = ftNameOf(file.path);
  useContextMenu().show(anchor, cardMenuItems({ card, file, name, url: img.src }), name);
}

/**
 * Opens `img` in the picture viewer, if this click is one that should. Answers
 * whether it did, so the caller knows to keep the click to itself.
 */
function viewPicture(img: HTMLImageElement): boolean {
  const opens = opensPictureViewer({
    isImage: true,
    isRenderedPicture: img.classList.contains("bb-img"),
    // A picture that never decoded has nothing to magnify.
    decoded: img.naturalWidth > 0,
    inPlaceholder: !!img.closest(".bb-img-ph"),
    onButton: !!img.closest("button"),
    // A long press has just opened the picture's menu (`onRichLongPress`). Its
    // overlay normally swallows the click that follows on touch; this is the
    // guard for the browsers where that click lands here first anyway.
    menuOpen: useContextMenu().open,
  });
  if (!opens) return false;
  // `img.src` is the address the browser has already loaded and cached: a
  // `blob:` URL owned by files/preview-cache.ts, or an external one the user
  // allowed for that host. The viewer borrows it and never revokes it.
  openPictureViewer({ url: img.src, name: pictureNameOf(img) });
  return true;
}

/** The attribute is our renderer's, but the DOM is not the place to trust it. */
function cardActionOf(act: string | undefined): CardAction {
  if (act === "preview") return "preview";
  if (act === "play") return "play";
  return "download";
}

/**
 * Opens `video` in the player, if this click is one that should. Answers
 * whether it did, so the caller knows to keep the click to itself.
 */
function playVideo(video: HTMLVideoElement): boolean {
  const opens = opensVideoViewer({
    isVideo: true,
    isRenderedPoster: video.classList.contains("bb-video"),
    // A poster opens once it has settled on its still (files/video-poster.ts):
    // before that it has nothing to show, and may still be reading the very
    // link the player would open on.
    hasFrame: !!video.getAttribute("poster"),
    onButton: !!video.closest("button"),
    // A long press has just opened a menu (see viewPicture above).
    menuOpen: useContextMenu().open,
  });
  if (!opens) return false;
  // The address as it was set: a media link is kept relative, and `video.src`
  // would answer it absolute and never match. A poster keeps it in its own
  // attribute, having let go of `src` so as not to hold the link's one stream.
  const posterUrl = video.getAttribute(POSTER_URL_ATTR) ?? video.getAttribute("src") ?? video.src;
  const card = video.closest<HTMLElement>(".bb-file");
  const file = card ? readCard(card.dataset) : null;
  const plan = planPosterClick({
    posterUrl,
    link: file ? keptVideoLink(file) : undefined,
    now: Date.now(),
    canRenew: card !== null && file !== null,
  });
  // A link that has run out goes the Play button's way: a fresh link, the
  // poster moved onto it (files/video-poster.ts), and the player opened on it.
  if (plan.kind === "renew" && card) void onFileCardAction(card, "play");
  // A `blob:` URL is bytes this page already holds (chat/files/videos.ts); a
  // media link is one the hub still serves. The player borrows either and
  // never revokes it.
  else openVideoViewer({ url: posterUrl, name: video.title });
  return true;
}

function loadPlaceholder(placeholder: HTMLElement, always: boolean): void {
  // Checked again: the attribute came out of our own renderer, but the DOM is
  // not the place to start trusting it.
  const href = safeHttpUrl(placeholder.dataset.bbImg ?? "");
  if (!href) return;
  if (always) useChatSettingsStore().allowImageHost(new URL(href).host);
  // "Always" also re-renders the message, but swapping now avoids a flash.
  const holder = document.createElement("template");
  holder.innerHTML = imageTag(href);
  placeholder.replaceWith(holder.content);
}

function selectClient(clid: number, uid: string | undefined): void {
  const ts = useTsStore();
  const clients = [...ts.clients.values()];
  const byUid = uid ? clients.find((c) => c.uid === uid) : undefined;
  const byId = ts.clients.get(clid);
  const found = byUid ?? (byId && (!uid || byId.uid === uid) ? byId : undefined);
  if (found) ts.select("client", String(found.id));
  else ts.pushEvent(t("chat.linkClientGone"), "warn");
}

function selectChannel(cid: string): void {
  const ts = useTsStore();
  if (ts.channels.has(cid)) ts.select("channel", cid);
  else ts.pushEvent(t("chat.linkChannelGone"), "warn");
}
