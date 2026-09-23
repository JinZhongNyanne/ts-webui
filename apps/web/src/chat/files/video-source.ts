/**
 * Where a chat video plays from — the choice videos.ts makes before anything
 * is fetched, kept pure so it can be tested without a page.
 *
 * In order: bytes this page already holds whole (a `blob:` URL costs nothing,
 * whatever the hub offers); a media link kept from earlier, while it still
 * has MEDIA_LINK_MARGIN_MS to live; a new media link, when the hub says it
 * serves them (FtLimits.mediaStreaming); and otherwise the whole file,
 * fetched once, which is all an older hub can do.
 */
import type { FtMediaTicket } from "@jinz/protocol";

/**
 * A kept media link is not handed out with less than this left: a player
 * opened on it asks again at every seek, and a link that expires under it
 * turns the next seek into an error.
 */
export const MEDIA_LINK_MARGIN_MS = 60_000;

export type VideoPlan =
  /** Bytes already held whole. */
  | { readonly kind: "blob"; readonly url: string }
  /** A media link kept from earlier, still good. */
  | { readonly kind: "link"; readonly url: string }
  /** Ask the hub for a media link. */
  | { readonly kind: "stream" }
  /** Fetch the file whole (the hub has no media links). */
  | { readonly kind: "fetch" };

export interface VideoPlanInput {
  /** Whether the hub hands out media links. */
  readonly streaming: boolean;
  /** The clip's `blob:` URL, when its bytes are here. */
  readonly blobUrl?: string;
  /** The last media link the hub gave for the clip. */
  readonly link?: FtMediaTicket;
  readonly now: number;
}

export function planVideo(input: VideoPlanInput): VideoPlan {
  if (input.blobUrl) return { kind: "blob", url: input.blobUrl };
  if (!input.streaming) return { kind: "fetch" };
  const link = input.link;
  if (link && link.expiresAt - input.now > MEDIA_LINK_MARGIN_MS) {
    return { kind: "link", url: link.url };
  }
  return { kind: "stream" };
}

/** What a click on a video poster in chat does (chat/richClick.ts). */
export type PosterClickPlan =
  /** Open the player on this address. */
  | { readonly kind: "open"; readonly url: string }
  /** Mint a fresh media link first — what the card's Play button does. */
  | { readonly kind: "renew" };

export interface PosterClickInput {
  /** The address the poster was posted with (its `src` attribute, as set). */
  readonly posterUrl: string;
  /** The last media link the hub gave for the clip, if the page still has it. */
  readonly link?: FtMediaTicket;
  readonly now: number;
  /** Whether the poster's card is there to renew the link through. */
  readonly canRenew: boolean;
}

/**
 * The poster opens the player on the address it already has — unless that is
 * a media link the player could no longer use.
 *
 * A `blob:` poster is bytes this page holds, which do not expire. A poster on
 * a media link is only as good as that link: once it is within
 * MEDIA_LINK_MARGIN_MS of expiring (the margin planVideo keeps, for the same
 * reason — the player asks again at every seek) the click renews it the way
 * the card's Play button would, rather than opening a player that can only say
 * the clip can no longer be played. A link the page no longer knows (a
 * reconnect cleared them, or a newer one replaced it) counts as expired too:
 * it belongs to a connection that is gone. Without a card to renew through,
 * the click still opens what it has, which is no worse than before.
 */
export function planPosterClick(input: PosterClickInput): PosterClickPlan {
  const open = { kind: "open", url: input.posterUrl } as const;
  if (input.posterUrl.startsWith("blob:") || !input.canRenew) return open;
  const link = input.link;
  const current =
    link !== undefined &&
    link.url === input.posterUrl &&
    link.expiresAt - input.now > MEDIA_LINK_MARGIN_MS;
  return current ? open : { kind: "renew" };
}
