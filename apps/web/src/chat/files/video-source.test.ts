import { describe, expect, it } from "vitest";
import type { FtMediaTicket } from "@jinz/protocol";
import { MEDIA_LINK_MARGIN_MS, planPosterClick, planVideo } from "./video-source";

const link = (expiresAt: number): FtMediaTicket => ({
  url: `/api/files/media/${"m".repeat(32)}`,
  expiresAt,
  size: 100_000_000,
  name: "clip.webm",
  type: "video/webm",
});

describe("planVideo", () => {
  it("fetches the clip whole from a hub without media links", () => {
    expect(planVideo({ streaming: false, now: 0 })).toEqual({ kind: "fetch" });
  });

  it("asks for a media link from a hub that serves them", () => {
    expect(planVideo({ streaming: true, now: 0 })).toEqual({ kind: "stream" });
  });

  it("plays bytes already held whole without asking anything, either way", () => {
    for (const streaming of [false, true]) {
      expect(planVideo({ streaming, blobUrl: "blob:x", now: 0 })).toEqual({
        kind: "blob",
        url: "blob:x",
      });
    }
  });

  it("reuses a kept link while it has time left, and asks again when it is nearly gone", () => {
    const kept = link(10 * 60_000);
    expect(planVideo({ streaming: true, link: kept, now: 0 })).toEqual({
      kind: "link",
      url: kept.url,
    });
    const nearlyGone = kept.expiresAt - MEDIA_LINK_MARGIN_MS;
    expect(planVideo({ streaming: true, link: kept, now: nearlyGone })).toEqual({
      kind: "stream",
    });
  });

  it("never plays a kept link once the hub stopped offering them", () => {
    expect(planVideo({ streaming: false, link: link(10 * 60_000), now: 0 })).toEqual({
      kind: "fetch",
    });
  });
});

describe("planPosterClick", () => {
  const fresh = link(10 * 60_000);

  it("opens a poster of bytes held whole on them, whatever link is kept", () => {
    for (const kept of [undefined, fresh, link(0)]) {
      expect(planPosterClick({ posterUrl: "blob:x", link: kept, now: 0, canRenew: true })).toEqual({
        kind: "open",
        url: "blob:x",
      });
    }
  });

  it("opens a poster on its media link while that link has time left", () => {
    expect(planPosterClick({ posterUrl: fresh.url, link: fresh, now: 0, canRenew: true })).toEqual({
      kind: "open",
      url: fresh.url,
    });
  });

  it("asks for a fresh link when the poster's has expired or nearly has", () => {
    const nearlyGone = fresh.expiresAt - MEDIA_LINK_MARGIN_MS;
    for (const now of [nearlyGone, fresh.expiresAt, fresh.expiresAt + 1]) {
      expect(planPosterClick({ posterUrl: fresh.url, link: fresh, now, canRenew: true })).toEqual({
        kind: "renew",
      });
    }
  });

  it("asks for a fresh link when the page no longer knows the poster's (a reconnect)", () => {
    expect(planPosterClick({ posterUrl: fresh.url, now: 0, canRenew: true })).toEqual({
      kind: "renew",
    });
    const other = { ...link(10 * 60_000), url: `/api/files/media/${"n".repeat(32)}` };
    expect(planPosterClick({ posterUrl: fresh.url, link: other, now: 0, canRenew: true })).toEqual({
      kind: "renew",
    });
  });

  it("still opens what it has when there is no card to renew the link through", () => {
    expect(
      planPosterClick({ posterUrl: fresh.url, link: fresh, now: fresh.expiresAt, canRenew: false }),
    ).toEqual({ kind: "open", url: fresh.url });
  });
});
