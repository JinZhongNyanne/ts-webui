import { describe, expect, it } from "vitest";
import { pageBuildIsStale } from "./build";

describe("pageBuildIsStale", () => {
  it("is true when the hub reports a different build (newer or rolled back) than the page was built from", () => {
    expect(pageBuildIsStale("abc1234", "def5678")).toBe(true);
  });

  it("is false when both sides are the same build", () => {
    expect(pageBuildIsStale("abc1234", "abc1234")).toBe(false);
  });

  it("is false when either side does not know its build (dev servers, older hubs)", () => {
    expect(pageBuildIsStale("", "def5678")).toBe(false);
    expect(pageBuildIsStale("abc1234", "")).toBe(false);
    expect(pageBuildIsStale("abc1234", undefined)).toBe(false);
    expect(pageBuildIsStale(undefined, "def5678")).toBe(false);
  });

  it("ignores surrounding whitespace from the build environment", () => {
    expect(pageBuildIsStale(" abc1234\n", "abc1234")).toBe(false);
  });
});
