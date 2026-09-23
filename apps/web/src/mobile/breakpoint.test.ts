import { describe, expect, it } from "vitest";
import { MOBILE_MAX_WIDTH, MOBILE_MEDIA_QUERY, isMobileWidth } from "./breakpoint";

describe("isMobileWidth", () => {
  it("treats a phone-sized viewport as mobile", () => {
    expect(isMobileWidth(360)).toBe(true);
    expect(isMobileWidth(414)).toBe(true);
  });

  it("includes the breakpoint itself", () => expect(isMobileWidth(MOBILE_MAX_WIDTH)).toBe(true));

  it("treats anything wider as desktop", () => {
    expect(isMobileWidth(MOBILE_MAX_WIDTH + 1)).toBe(false);
    expect(isMobileWidth(1440)).toBe(false);
  });

  it("falls back to desktop for a width it cannot read", () => {
    expect(isMobileWidth(Number.NaN)).toBe(false);
    expect(isMobileWidth(0)).toBe(false);
  });

  it("states the same breakpoint in its media query", () =>
    expect(MOBILE_MEDIA_QUERY).toBe(`(max-width: ${MOBILE_MAX_WIDTH}px)`));
});
