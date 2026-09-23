/**
 * M3 video streaming: a video posted in channel chat plays from a media link
 * the hub streams with range requests, not from a copy fetched whole.
 *
 * Alice posts the fixture clip; Bob, on a throttled connection (so the clip
 * cannot all be in his browser before he seeks), presses Play. The hub answers
 * his player's requests to `/api/files/media/…` with 206 and a Content-Range;
 * a seek far ahead makes a new request that starts part-way in (the hub's
 * `ftinitdownload seekpos=a`), and the clip goes on playing from there. The
 * bytes a range brings are then checked against the fixture at that offset,
 * so the offset really is where TeamSpeak started. Finally the hub's
 * refusals: HEAD answers from the link alone, a range past the end is a 416,
 * and a media link cannot be had for an HTML file. Last, the poster: a click
 * on it reopens the player on the link it has while that link is good, and
 * mints a fresh one — as the card's Play button would — once it has run out.
 *
 * Throughout, every request to a media link is followed from start to end. A
 * link runs one stream at a time and a new request cuts the running one, so
 * the poster must let go of its request once it has its first frame (a still,
 * files/video-poster.ts): the poster's requests all end before the player
 * needs the link, none is cut by the hub, no request is refused with a 429,
 * and the poster still shows its frame afterwards. A closed player lets go of
 * its request too.
 *
 * The fixture (`fixtures/stream-test.webm`, 20 s of VP8 test pattern at
 * 320×180, 15 fps, no audio, 762 447 bytes) was made with ffmpeg 8.1 in an
 * alpine container, and comes out byte-identical every time:
 *
 *   ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15:duration=20 \
 *     -c:v libvpx -b:v 300k -threads 1 -g 30 -an \
 *     -fflags +bitexact -flags +bitexact -map_metadata -1 stream-test.webm
 *
 * VP8 in WebM because the rig's Chromium has no H.264. The WebM muxer writes
 * its cues at the end, so the player itself asks for a late range on the way.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { until } from "../lib/rig.mjs";

export const title = "m3 video stream: 206 ranges from a media link, seek, playback continues";

const FIXTURE = new URL("../fixtures/stream-test.webm", import.meta.url);
const MEDIA_PATH = "/api/files/media/";
/** Bob's download speed: well under what the whole clip would need to arrive at once. */
const THROTTLE_BYTES_PER_S = 48 * 1024;
/** Where Bob seeks to, seconds into the 20 s clip: far past anything buffered. */
const SEEK_TO_S = 15;
/** Ranges this close to the end are the WebM cues, not the seek target. */
const TAIL_BYTES = 64 * 1024;
/** How a request the page gave up on itself ends; anything else failing was cut. */
const ABORTED_BY_PAGE = "net::ERR_ABORTED";
/** Where the poster keeps its address once it has let go of `src` (files/video-poster.ts). */
const POSTER_URL_ATTR = "data-video-url";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The player's requests that went out while one of the poster's was still
 * open, as the page saw it. The hub runs one stream per link, so each of these
 * is the poster and the player cutting each other.
 */
function racedPoster(streams) {
  const poster = streams.filter((s) => s.by === "poster");
  return streams.filter(
    (later) =>
      later.by === "player" && poster.some((p) => p.endSeq === null || p.endSeq > later.startSeq),
  );
}

/** Requests to media links, counted by who made them and how they ended. */
function streamCounts(streams) {
  const count = (by, end) =>
    streams.filter((s) => s.by === by && (end === undefined || s.end === end)).length;
  return {
    poster: count("poster"),
    posterReleased: count("poster", ABORTED_BY_PAGE),
    player: count("player"),
    playerFinished: count("player", "finished"),
    playerAbortedByItself: count("player", ABORTED_BY_PAGE),
    open: streams.filter((s) => s.end === null).length,
    racedPoster: racedPoster(streams).length,
    truncated: streams.filter((s) => {
      const range = parseContentRange(s.contentRange);
      return (
        s.end === "finished" &&
        range &&
        s.bytes !== undefined &&
        s.bytes < range.end - range.start + 1
      );
    }).length,
    failedOtherwise: streams.filter(
      (s) => s.end && s.end !== "finished" && s.end !== ABORTED_BY_PAGE,
    ).length,
  };
}

/** One line per media request: whose, what it asked, what came back, how it ended. */
function streamLines(streams) {
  return streams.map(
    (s) =>
      `    ${s.by} ${s.range ?? "-"} -> ${s.contentRange ?? "(no answer)"}, ` +
      `${s.bytes ?? "?"} bytes, ${s.end ?? "still open"}`,
  );
}

/** `bytes a-b/total` -> {start, end, total}; null for anything else. */
function parseContentRange(value) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}

export default async function m3VideoStream(rig) {
  const cid = rig.channels.a;
  const channel = rig.channels.name("a");
  const clip = await readFile(FIXTURE);
  const name = `stream ${rig.runId}.webm`;
  const created = new Set();
  try {
    const alice = await rig.connect("vsalice", { admin: true });
    const bob = await rig.connect("vsbob");
    await rig.waitForClientInTree(alice.page, bob.nick);

    /* ---- Alice posts the clip ---- */
    const alicePanel = await rig.openChat(alice.page, channel);
    await alicePanel.locator(".composer .attach").waitFor({ state: "visible" });
    await alicePanel.locator("input.picker").setInputFiles({
      name,
      mimeType: "video/webm",
      buffer: clip,
    });
    created.add(`/files/${name}`);

    /* ---- Bob, throttled, watches every answer to a media link ---- */
    /**
     * Every request to a media link, and whose it was: the poster's until the
     * poster has its still, the player's after (the player opens only once
     * the poster has settled, files/card-actions.ts).
     */
    const streams = [];
    let posterSettled = false;
    /** Orders starts and ends as the page reported them. */
    let seq = 0;
    const streamOf = (req) => streams.find((s) => s.req === req);
    bob.page.on("request", (req) => {
      if (!new URL(req.url()).pathname.startsWith(MEDIA_PATH)) return;
      const by = posterSettled ? "player" : "poster";
      const range = req.headers()["range"] ?? null;
      streams.push({ req, by, range, end: null, startSeq: seq++, endSeq: null });
    });
    bob.page.on("requestfinished", (req) => {
      const s = streamOf(req);
      if (!s) return;
      s.end = "finished";
      s.endSeq = seq++;
      req
        .sizes()
        .then((sizes) => (s.bytes = sizes.responseBodySize))
        .catch(() => undefined);
    });
    bob.page.on("requestfailed", (req) => {
      const s = streamOf(req);
      if (!s) return;
      s.end = req.failure()?.errorText ?? "failed";
      s.endSeq = seq++;
    });
    await bob.page.exposeFunction("__e2ePosterSettled", () => {
      posterSettled = true;
    });
    await bob.page.evaluate(() => {
      new MutationObserver((records) => {
        const still = records.some(
          (r) => r.target.matches?.("video.bb-video") && r.target.getAttribute("poster"),
        );
        if (still) void window.__e2ePosterSettled();
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["poster"] });
    });

    const media = [];
    /** The session id the page sent with its media-ticket request. */
    let sessionId = "";
    /** How many media links the page has asked for. */
    let ticketsAsked = 0;
    bob.page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/files/media-ticket") {
        sessionId = req.headers()["x-session-id"] ?? "";
        ticketsAsked += 1;
      }
    });
    bob.page.on("response", (res) => {
      const url = new URL(res.url());
      if (!url.pathname.startsWith(MEDIA_PATH)) return;
      const stream = streamOf(res.request());
      if (stream) stream.contentRange = res.headers()["content-range"] ?? null;
      const headers = res.headers();
      media.push({
        method: res.request().method(),
        status: res.status(),
        range: res.request().headers()["range"] ?? null,
        contentRange: headers["content-range"] ?? null,
        type: headers["content-type"] ?? null,
        disposition: headers["content-disposition"] ?? null,
        nosniff: headers["x-content-type-options"] ?? null,
        acceptRanges: headers["accept-ranges"] ?? null,
        path: url.pathname,
      });
    });
    const cdp = await bob.page.context().newCDPSession(bob.page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 20,
      downloadThroughput: THROTTLE_BYTES_PER_S,
      uploadThroughput: -1,
    });

    const bobPanel = await rig.openChat(bob.page, channel);
    // Chat may have had to store it under a stamped name in the channel's root
    // (uploader.ts, when the folder cannot be made or listed): match either.
    const stem = name.replace(/\.webm$/, "");
    const card = bobPanel
      .locator(".bb-file")
      .filter({ has: bob.page.locator(".bb-file-name", { hasText: stem }) })
      .first();
    await card.waitFor({ state: "visible", timeout: 30_000 });
    const stored = await card.evaluate((el) => el.dataset.ftPath ?? "");
    if (stored) created.add(stored);
    await card.locator('[data-ft-act="play"]').click();

    /* ---- the player opens on a media link, answered 206 ---- */
    const video = bob.page.locator(".viewer-video");
    await video.waitFor({ state: "attached", timeout: 30_000 });
    const src = await video.evaluate((v) => v.getAttribute("src"));
    assert.ok(src?.startsWith(MEDIA_PATH), `the player streams a media link, not a blob (${src})`);
    const first = await until(
      () => media.find((r) => r.status === 206 && r.path === src),
      "a 206 answer to the player's media link",
    );
    const firstRange = parseContentRange(first.contentRange);
    assert.ok(firstRange, `Content-Range on the 206 (${first.contentRange})`);
    assert.equal(firstRange.total, clip.length, "Content-Range names the whole file's length");
    assert.equal(firstRange.end, clip.length - 1, "open-ended: to the last byte");
    assert.equal(first.type, "video/webm");
    assert.equal(first.acceptRanges, "bytes");
    assert.equal(first.nosniff, "nosniff");
    assert.equal(first.disposition, null, "served inline, never as an attachment");
    console.log(`  first answer: ${first.status} ${first.contentRange} (asked ${first.range})`);

    /* ---- the poster let go of the link before the player took it, and kept its frame ---- */
    const poster = card.locator("video.bb-video").first();
    assert.ok(posterSettled, "the poster settled on a still before the player opened");
    const posterStreams = streams.filter((s) => s.by === "poster");
    assert.ok(posterStreams.length > 0, "the poster read its first frame from the link");
    await until(
      () => posterStreams.every((s) => s.end !== null),
      "the poster holds no media request once it has its still",
      10_000,
    );
    const still = await poster.evaluate(async (v) => {
      const img = new Image();
      img.src = v.getAttribute("poster") ?? "";
      await img.decode();
      const box = v.getBoundingClientRect();
      return {
        src: v.getAttribute("src"),
        type: img.src.slice(0, "data:image/jpeg".length),
        width: img.naturalWidth,
        height: img.naturalHeight,
        shown: [Math.round(box.width), Math.round(box.height)],
      };
    });
    assert.equal(still.src, null, "the poster has no source left to stream");
    assert.equal(still.type, "data:image/jpeg", "the poster shows a still of its first frame");
    assert.deepEqual([still.width, still.height], [320, 180], "the still is the clip's frame");
    assert.ok(still.shown[0] > 0 && still.shown[1] > 0, `the poster is on screen (${still.shown})`);
    console.log(
      `  poster: ${posterStreams.length} request(s), all ended; ` +
        `still ${still.width}x${still.height} shown at ${still.shown.join("x")}`,
    );

    /* ---- it plays ---- */
    await bob.page.getByTestId("viewer-play").click();
    await until(
      () => video.evaluate((v) => !v.paused && v.currentTime > 0.5),
      "the clip plays from the start",
    );
    const beforeSeek = media.length;
    const buffered = await video.evaluate((v) =>
      v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0,
    );
    assert.ok(buffered < SEEK_TO_S, `the seek target is not buffered yet (${buffered}s)`);

    /* ---- a seek far ahead is a new range request, part-way into the file ---- */
    const timeBefore = await video.evaluate((v) => v.currentTime);
    await video.evaluate((v, to) => {
      v.currentTime = to;
    }, SEEK_TO_S);
    // Not the few kilobytes of cues at the very end, which the player may read
    // again first: a range from somewhere in the middle, where the target is.
    const intoTheMiddle = (r) => {
      const range = parseContentRange(r.contentRange);
      return r.status === 206 && range && range.start > 0 && range.total - range.start > TAIL_BYTES;
    };
    const seekAnswer = await until(
      () => media.slice(beforeSeek).find(intoTheMiddle),
      "a 206 starting part-way into the file after the seek",
    );
    const seekRange = parseContentRange(seekAnswer.contentRange);
    console.log(
      `  seek answer: ${seekAnswer.status} ${seekAnswer.contentRange} (asked ${seekAnswer.range})`,
    );
    assert.equal(seekRange.end, clip.length - 1);

    /* ---- and playback continues from there ---- */
    const afterSeek = await until(async () => {
      const t = await video.evaluate((v) => (v.paused || v.seeking ? 0 : v.currentTime));
      return t >= SEEK_TO_S ? t : 0;
    }, "the player resumes at the seek target");
    const later = await until(async () => {
      const t = await video.evaluate((v) => v.currentTime);
      return t > afterSeek + 1 ? t : 0;
    }, "currentTime advances after the seek");
    console.log(
      `  currentTime: ${timeBefore.toFixed(2)}s before the seek, ` +
        `${afterSeek.toFixed(2)}s once it landed, ${later.toFixed(2)}s later`,
    );
    for (const r of media) {
      console.log(`    ${r.method} ${r.range ?? "-"} -> ${r.status} ${r.contentRange}`);
    }
    const failed = media.filter((r) => r.status >= 400);
    assert.deepEqual(failed, [], "no media request was refused during playback");
    assert.equal(streamCounts(streams).racedPoster, 0, "the player never raced the poster");

    /* ---- the offset is where TeamSpeak really started ---- */
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await bob.page.getByTestId("viewer-close").click();
    await until(
      () => streams.every((s) => s.end !== null),
      "a closed player holds no media request",
      10_000,
    );
    const counts = streamCounts(streams);
    console.log(`  media requests while posting, playing and seeking: ${JSON.stringify(counts)}`);
    for (const line of streamLines(streams)) console.log(line);
    assert.equal(counts.racedPoster, 0, "no request of the player's went out beside the poster's");
    assert.equal(counts.failedOtherwise, 0, "no media request failed but by the page's own hand");
    // Through the dev proxy a stream the hub cuts can end looking complete.
    assert.equal(counts.truncated, 0, "every media request that ended brought all it announced");
    assert.equal(
      media.filter((r) => r.status === 429).length,
      0,
      "no media request was refused as too many",
    );
    const offset = 500_000;
    const probe = await bob.page.evaluate(
      async ({ url, offset }) => {
        const res = await fetch(url, { headers: { range: `bytes=${offset}-` } });
        const bytes = new Uint8Array(await res.arrayBuffer());
        const head = await fetch(url, { method: "HEAD", headers: { range: "bytes=10-" } });
        const past = await fetch(url, { headers: { range: "bytes=99999999-" } });
        return {
          status: res.status,
          contentRange: res.headers.get("content-range"),
          base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")),
          head: [
            head.status,
            head.headers.get("content-range"),
            head.headers.get("content-length"),
          ],
          past: [past.status, past.headers.get("content-range")],
        };
      },
      { url: src, offset },
    );
    assert.equal(probe.status, 206);
    assert.equal(probe.contentRange, `bytes ${offset}-${clip.length - 1}/${clip.length}`);
    assert.equal(
      sha(Buffer.from(probe.base64, "base64")),
      sha(clip.subarray(offset)),
      "the range's bytes are the fixture's from that offset",
    );
    assert.deepEqual(probe.head, [
      206,
      `bytes 10-${clip.length - 1}/${clip.length}`,
      String(clip.length - 10),
    ]);
    assert.deepEqual(probe.past, [416, `bytes */${clip.length}`]);

    /* ---- no media link for anything that is not video or audio ---- */
    assert.ok(sessionId, "the page asked for its media link with its session id");
    const refused = await bob.page.evaluate(
      async ({ cid, sessionId }) => {
        const res = await fetch("/api/files/media-ticket", {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-id": sessionId },
          body: JSON.stringify({ cid, path: "/files/page.html" }),
        });
        return [res.status, await res.json()];
      },
      { cid, sessionId },
    );
    assert.deepEqual(refused, [415, { error: "not_media", message: "media.notMedia" }]);

    /* ---- the poster reuses a good link, and renews one that has run out ---- */
    await poster.waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(
      await poster.getAttribute(POSTER_URL_ATTR),
      src,
      "the poster was posted on the player's link",
    );
    const askedBefore = ticketsAsked;
    await poster.click();
    await video.waitFor({ state: "attached", timeout: 15_000 });
    assert.equal(await video.getAttribute("src"), src, "a good link is reused as it is");
    assert.equal(ticketsAsked, askedBefore, "reusing a good link asks the hub for nothing");
    await bob.page.getByTestId("viewer-close").click();
    await video.waitFor({ state: "detached", timeout: 15_000 });

    // Eleven minutes on, as far as the page can tell: its ten-minute link has
    // run out. Only the page's clock moves — the hub's does not, and it is the
    // page's decision that is under test.
    await bob.page.evaluate(() => {
      const real = Date.now.bind(Date);
      window.__e2eRealNow = real;
      Date.now = () => real() + 11 * 60_000;
    });
    try {
      await poster.click();
      const renewed = await until(async () => {
        const now = await video.getAttribute("src", { timeout: 1_000 }).catch(() => null);
        return now && now !== src ? now : null;
      }, "the player opens on a fresh media link");
      assert.ok(renewed.startsWith(MEDIA_PATH), `a fresh media link, not a blob (${renewed})`);
      assert.equal(ticketsAsked, askedBefore + 1, "the expired link was replaced by asking once");
      assert.equal(
        await poster.getAttribute(POSTER_URL_ATTR),
        renewed,
        "the poster moved onto it too",
      );
      assert.equal(await poster.getAttribute("src"), null, "without streaming it again");
      await until(
        () => video.evaluate((v) => v.readyState >= HTMLMediaElement.HAVE_METADATA),
        "the renewed player loads the clip",
      );
      assert.equal(
        await bob.page.locator(".viewer-failed").count(),
        0,
        "the player does not say the clip can no longer be played",
      );
      console.log(`  poster renewed ${src.slice(-8)} -> ${renewed.slice(-8)}`);
    } finally {
      await bob.page.evaluate(() => {
        if (window.__e2eRealNow) Date.now = window.__e2eRealNow;
      });
    }
    await bob.page.getByTestId("viewer-close").click();
  } finally {
    for (const path of created) {
      await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: path }).catch(() => undefined);
    }
    await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: "/files" }).catch(() => undefined);
  }
}
