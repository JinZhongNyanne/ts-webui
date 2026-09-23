import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { redactText, redactUrl, redactingLoggerOptions } from "./logger.js";

const TICKET = "c".repeat(32);

describe("request log redaction", () => {
  it("hides the session id a URL carries", () => {
    expect(redactUrl("/api/tts/speak?text=hi&session=abc-123")).toBe(
      "/api/tts/speak?text=hi&session=***",
    );
    expect(redactUrl("/api/ts/abc-123/icon/5")).toBe("/api/ts/***/icon/5");
    expect(redactUrl("/api/profile/icon?uid=x&rev=2&session=abc")).toBe(
      "/api/profile/icon?uid=x&rev=2&session=***",
    );
  });

  it("hides the asset token a URL carries", () => {
    const token = "a".repeat(32);
    expect(redactUrl(`/api/ts/${token}/avatar/x`)).toBe("/api/ts/***/avatar/x");
    expect(redactUrl("/api/tts/speak?text=hi&token=abc")).toBe("/api/tts/speak?text=hi&token=***");
    expect(redactUrl("/api/profile/icon?uid=x&rev=2&token=abc")).toBe(
      "/api/profile/icon?uid=x&rev=2&token=***",
    );
  });

  it("hides one-use download links", () => {
    expect(redactUrl(`/api/files/download/${"b".repeat(32)}`)).toBe("/api/files/download/***");
    expect(redactUrl("/api/files/upload?cid=5&path=%2Fa")).toBe(
      "/api/files/upload?cid=5&path=%2Fa",
    );
  });

  it("hides media links, which stay usable for minutes and many times", () => {
    // A <video> cannot send x-session-id, so the link alone lets anyone who
    // reads the log stream the file while its owner is online.
    expect(redactUrl(`/api/files/media/${TICKET}`)).toBe("/api/files/media/***");
    expect(redactUrl(`/api/files/media/${TICKET}?t=1`)).toBe("/api/files/media/***?t=1");
    expect(redactUrl("/api/files/media-ticket")).toBe("/api/files/media-ticket");
  });

  it("leaves ordinary URLs untouched", () => {
    expect(redactUrl("/api/health")).toBe("/api/health");
    expect(redactUrl("/api/music-bot/music/search?q=hello")).toBe(
      "/api/music-bot/music/search?q=hello",
    );
  });
});

describe("log message redaction", () => {
  it("hides links wherever they appear in a string", () => {
    expect(redactText(`Route GET:/api/files/media/${TICKET}/x not found`)).toBe(
      "Route GET:/api/files/media/***/x not found",
    );
    expect(redactText(`in "/api/files/download/${TICKET}" (GET)`)).toBe(
      'in "/api/files/download/***" (GET)',
    );
    expect(redactText("GET /api/ts/abc-123/icon/5 and /api/tts/speak?session=abc&x=1")).toBe(
      "GET /api/ts/***/icon/5 and /api/tts/speak?session=***&x=1",
    );
    expect(redactText("nothing to hide")).toBe("nothing to hide");
  });

  /** Everything a logger built with the hub's options writes, one parsed line per entry. */
  function capture(): { log: pino.Logger; lines: () => Record<string, unknown>[] } {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const log = pino({ ...redactingLoggerOptions(), level: "trace" }, sink);
    const lines = () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    return { log, lines };
  }

  it("hides a link in a message Fastify logs itself (its 404)", () => {
    const { log, lines } = capture();
    log.info(`Route GET:/api/files/media/${TICKET}/ not found`);
    log.info({ n: 1 }, `also /api/files/media/${TICKET}`);
    const text = JSON.stringify(lines());
    expect(text).not.toContain(TICKET);
    expect(lines()[0]!["msg"]).toBe("Route GET:/api/files/media/***/ not found");
  });

  it("hides a link in a logged error's message and stack", () => {
    const { log, lines } = capture();
    const err = new Error(`Reply was already sent in "/api/files/media/${TICKET}" (GET)`);
    log.warn({ err }, "oops");
    const [entry] = lines();
    expect(JSON.stringify(entry)).not.toContain(TICKET);
    expect((entry!["err"] as { message: string }).message).toContain("/api/files/media/***");
  });

  it("hides a link in the request a log line carries", () => {
    const { log, lines } = capture();
    log.info({ req: { method: "GET", url: `/api/files/media/${TICKET}`, ip: "1.2.3.4" } }, "in");
    expect(JSON.stringify(lines())).not.toContain(TICKET);
  });
});
