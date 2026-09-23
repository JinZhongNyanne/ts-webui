import { describe, expect, it } from "vitest";
import { decodeTextCode, encodeTextCode } from "./text-code.js";

describe("text codes", () => {
  it("passes a bare key through untouched", () => {
    expect(encodeTextCode("hub.connectTimeout")).toBe("hub.connectTimeout");
    expect(decodeTextCode("hub.connectTimeout")).toEqual({ key: "hub.connectTimeout" });
  });

  it("round-trips params", () => {
    const wire = encodeTextCode("hub.tsRejected", { reason: "banned, 说明", id: "3329" });
    expect(decodeTextCode(wire)).toEqual({
      key: "hub.tsRejected",
      params: { reason: "banned, 说明", id: "3329" },
    });
  });

  it("drops an empty param bag rather than encoding it", () => {
    expect(encodeTextCode("a.b", {})).toBe("a.b");
  });

  it("treats raw server text as a key so it still reaches the user", () => {
    expect(decodeTextCode("socket hang up")).toEqual({ key: "socket hang up" });
  });

  it("falls back to the key when the params are malformed", () => {
    expect(decodeTextCode("a.b\u0001{not json")).toEqual({ key: "a.b" });
  });
});
