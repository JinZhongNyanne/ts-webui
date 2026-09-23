import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./messages.js";

describe("ClientMessageSchema", () => {
  it("accepts an asset token refresh", () => {
    expect(ClientMessageSchema.safeParse({ type: "assetToken.refresh" }).success).toBe(true);
  });

  it("rejects an unknown message type", () => {
    expect(ClientMessageSchema.safeParse({ type: "assetToken.steal" }).success).toBe(false);
  });
});
