import { beforeEach, describe, expect, it } from "vitest";
import { nextTick, watch } from "vue";
import {
  assetExpiresAt,
  assetToken,
  clearAssetToken,
  hasAssetToken,
  setAssetToken,
} from "./asset-token";

describe("asset token", () => {
  beforeEach(() => {
    clearAssetToken();
  });

  it("flips presence once on the first grant and not on a rotation", async () => {
    let flips = 0;
    const stop = watch(hasAssetToken, () => {
      flips += 1;
    });
    setAssetToken({ token: "first", expiresAt: 1_000 });
    await nextTick();
    expect(flips).toBe(1);
    expect(hasAssetToken.value).toBe(true);

    setAssetToken({ token: "second", expiresAt: 2_000 });
    await nextTick();
    expect(flips).toBe(1);
    stop();
  });

  it("returns the latest token and expiry from the plain getters", () => {
    setAssetToken({ token: "first", expiresAt: 1_000 });
    setAssetToken({ token: "second", expiresAt: 2_000 });
    expect(assetToken()).toBe("second");
    expect(assetExpiresAt()).toBe(2_000);
  });

  it("clears presence and empties the getters", async () => {
    setAssetToken({ token: "first", expiresAt: 1_000 });
    await nextTick();
    let flips = 0;
    const stop = watch(hasAssetToken, () => {
      flips += 1;
    });
    clearAssetToken();
    await nextTick();
    expect(flips).toBe(1);
    expect(hasAssetToken.value).toBe(false);
    expect(assetToken()).toBe("");
    expect(assetExpiresAt()).toBe(0);
    stop();
  });
});
