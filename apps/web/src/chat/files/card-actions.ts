/**
 * The buttons of a file card in chat (bbcode.ts renders it, richClick.ts
 * routes the click here):
 *
 * - download: the transfers store asks the hub for a fresh one-use link and
 *   hands it to the browser; nothing about the link is kept;
 * - preview (images): the same kind of link, fetched through the transfers
 *   store (so it waits in the same line, and the hub counts it like any
 *   other transfer) and shown from a `blob:` URL with the type taken from
 *   the name, so the image comes through the hub from the TeamSpeak server
 *   and never from a third party. A picture that arrives replaces the card
 *   with itself (sticker.ts), so what a shown image can still do lives in
 *   its menu instead — the two entries at the bottom of this file.
 * - play (videos a browser can play): a media link the player streams from
 *   when the hub serves them, else the same kind of fetch as a picture with
 *   the video's own larger limit (videos.ts); and then two things at once —
 *   the card grows a poster of the clip's first frame (video-poster.ts) and
 *   the player opens over the desktop (components/viewer). The poster is what
 *   makes the second viewing cheap: a click on it reopens the player on the
 *   address it already has (chat/richClick.ts).
 *
 * A channel with a password asks for it unless this page already knows one
 * that works; a typed one that works is remembered for everything else that
 * needs it (ts/channel-passwords.ts), a wrong one fails with the server's
 * reason and is not kept. Errors show in the card, translated.
 *
 * The bytes themselves are previews.ts's, so a picture already fetched (by
 * another card, or because it loaded itself) is shown without asking again.
 */
import { formatBytes, ftNameOf } from "@jinz/protocol";
import { t } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { useTransfersStore } from "../../stores/transfers";
import { askChannelPassword } from "./password-prompt";
import { passwordPlan } from "./card-password";
import {
  PREVIEW_MAX_BYTES,
  VIDEO_MAX_BYTES,
  canPlayVideo,
  canPreview,
  readCard,
  type CardFile,
} from "./card";
import { fetchPreview } from "./previews";
import { fetchVideo } from "./videos";
import { showSticker } from "./sticker";
import { showVideoPoster } from "./video-poster";
import { registerCardAction } from "./card-menu";
import { openVideoViewer } from "../../components/viewer/media-viewer";

export type CardAction = "download" | "preview" | "play";

function setStatus(card: HTMLElement, text: string, kind: "busy" | "error" | "" = ""): void {
  const status = card.querySelector<HTMLElement>(".bb-file-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.kind = kind;
}

/**
 * The password to use for the file's channel: undefined for none or a known
 * one (the store fills it in), a typed one, or null when the user cancelled
 * (or the channel is gone).
 */
async function passwordFor(card: HTMLElement, cid: string): Promise<string | undefined | null> {
  const ts = useTsStore();
  const channel = ts.channels.get(cid);
  const plan = passwordPlan(channel, ts.channelPasswordFor(cid));
  if (plan.kind === "gone") {
    setStatus(card, t("chatFiles.channelGone"), "error");
    return null;
  }
  if (plan.kind === "use") return plan.password;
  return askChannelPassword(channel!.name);
}

async function download(card: HTMLElement, file: CardFile, cpw: string | undefined) {
  const transfers = useTransfersStore();
  setStatus(card, t("chatFiles.downloading"), "busy");
  // "chat", so the file browser's list stays the file browser's.
  const id = transfers.downloadFile(file.cid, file.path, cpw, "chat");
  const done = await transfers.waitFor(id);
  if (done.state === "failed") setStatus(card, done.error ?? t("ft.failed"), "error");
  else setStatus(card, "");
}

async function preview(card: HTMLElement, file: CardFile, cpw: string | undefined) {
  if (!canPreview(file.size)) {
    setStatus(
      card,
      t("chatFiles.previewTooLarge", { max: formatBytes(PREVIEW_MAX_BYTES) }),
      "error",
    );
    return;
  }
  setStatus(card, t("chatFiles.loadingPreview"), "busy");
  const url = await fetchPreview(file, cpw);
  // The picture takes the card's place; one that will not decode leaves it.
  if (await showSticker(card, ftNameOf(file.path), url)) setStatus(card, "");
  else setStatus(card, t("chatFiles.notImage"), "error");
}

/**
 * Gets the clip's address (videos.ts), posts its first frame under the card
 * and opens the player on it. A streamed clip may be any size. One fetched
 * whole is refused here from what the card says, and refused again inside the
 * transfers store against the size the *server* reports before a single byte
 * moves — so an understated size cannot leave anyone waiting on half a
 * gigabyte with nothing but a spinner.
 */
async function playVideo(card: HTMLElement, file: CardFile, cpw: string | undefined) {
  if (!canPlayVideo(file.size, useTransfersStore().mediaStreaming)) {
    setStatus(card, t("chatFiles.videoTooLarge", { max: formatBytes(VIDEO_MAX_BYTES) }), "error");
    return;
  }
  const name = ftNameOf(file.path);
  setStatus(card, t("chatFiles.loadingVideo"), "busy");
  const url = await fetchVideo(file, cpw);
  // A file whose name promised a video this browser cannot actually decode: the
  // card keeps its Download button, which is the only honest offer left.
  if (!(await showVideoPoster(card, name, url))) {
    setStatus(card, t("chatFiles.notVideo"), "error");
    return;
  }
  setStatus(card, "");
  openVideoViewer({ url, name });
}

export async function onFileCardAction(card: HTMLElement, action: CardAction): Promise<void> {
  if (card.dataset.ftBusy) return;
  const file = readCard(card.dataset);
  if (!file) {
    setStatus(card, t("chatFiles.badLink"), "error");
    return;
  }
  card.dataset.ftBusy = "1";
  try {
    const cpw = await passwordFor(card, file.cid);
    if (cpw === null) return;
    if (action === "download") await download(card, file, cpw);
    else if (action === "play") await playVideo(card, file, cpw);
    else await preview(card, file, cpw);
  } catch (err) {
    setStatus(card, err instanceof Error ? err.message : t("ft.failed"), "error");
  } finally {
    delete card.dataset.ftBusy;
  }
}

/*
 * The menu of a shown picture (card-menu.ts). Both go through the registry,
 * so an entry added elsewhere sits among them as an equal.
 */
registerCardAction({
  id: "file.download",
  icon: "⬇",
  label: () => t("chatFiles.download"),
  run: (target) => void onFileCardAction(target.card, "download"),
});

registerCardAction({
  id: "file.openTab",
  icon: "↗",
  // The `blob:` URL is this page's own, so a new tab shows the picture at
  // full size without asking the hub for the bytes a second time.
  label: () => t("chatFiles.openTab"),
  enabled: (target) => target.url !== undefined,
  run: (target) => void window.open(target.url, "_blank", "noopener"),
});
