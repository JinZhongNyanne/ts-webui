import { describe, expect, it } from "vitest";
import { formatBytes, formatLoss, formatRate } from "./format";

describe("formatBytes", () => {
  it("scales by 1024 with one decimal past bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3542962)).toBe("3.4 MB");
    expect(formatBytes(8959736 * 1024 * 1024)).toBe("8.5 TB");
  });

  it("reads anything that is not a positive number as 0", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatRate", () => {
  it("is bytes per second", () => {
    expect(formatRate(40)).toBe("40 B/s");
    expect(formatRate(2048)).toBe("2.0 KB/s");
  });
});

describe("formatLoss", () => {
  it("shows a 0–1 ratio as a percentage with two decimals", () => {
    expect(formatLoss(0)).toBe("0.00 %");
    expect(formatLoss(0.0125)).toBe("1.25 %");
    expect(formatLoss(Number.NaN)).toBe("0.00 %");
  });
});
