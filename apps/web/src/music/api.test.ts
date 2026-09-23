import { describe, expect, it } from "vitest";
import { queueRemoveIndex, refusalMessage, requestBody } from "./api";

describe("refusalMessage", () => {
  it("reports the message when the bot refuses with ok:false", () => {
    expect(refusalMessage({ ok: false, message: "无法播放（区域/版权限制）" })).toBe(
      "无法播放（区域/版权限制）",
    );
  });

  it("falls back to error, then to a generic word", () => {
    expect(refusalMessage({ ok: false, error: "forbidden" })).toBe("forbidden");
    expect(refusalMessage({ ok: false })).toBe("failed");
  });

  it("passes a successful answer through", () => {
    expect(refusalMessage({ ok: true, message: "正在播放" })).toBeNull();
    expect(refusalMessage({ message: "Queue cleared" })).toBeNull();
    expect(refusalMessage(null)).toBeNull();
    expect(refusalMessage("nope")).toBeNull();
  });
});

describe("queueRemoveIndex", () => {
  /**
   * `DELETE /player/:id/queue/:index` runs the bot's `!remove <n>` command,
   * whose handler does `parseInt(args) - 1` — so the route counts from 1 while
   * `play-at`, on the same array, counts from 0. Verified against the live bot:
   * `queue/0` answers 200 "Usage: !remove <number>" and removes nothing, and
   * `queue/2` removes the song shown second.
   */
  it("turns our 0-based row into the bot's 1-based position", () => {
    expect(queueRemoveIndex(0)).toBe(1);
    expect(queueRemoveIndex(1)).toBe(2);
    expect(queueRemoveIndex(7)).toBe(8);
  });
});

describe("requestBody", () => {
  /**
   * A POST with no body at all reaches the hub through a reverse proxy as
   * `transfer-encoding: chunked` with no content type, which Fastify refuses
   * with 415 — that is how 下一曲 and 清空 failed. Sending `{}` names the type.
   */
  it("gives a body-less POST an empty JSON object", () => {
    expect(requestBody("POST", undefined)).toEqual({});
  });

  it("keeps a POST body as it is", () => {
    expect(requestBody("POST", { index: 2 })).toEqual({ index: 2 });
  });

  it("sends nothing with GET or DELETE", () => {
    expect(requestBody("GET", undefined)).toBeUndefined();
    expect(requestBody("DELETE", undefined)).toBeUndefined();
  });
});
