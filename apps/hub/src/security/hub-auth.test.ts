import { describe, expect, it } from "vitest";
import { HUB_AUTH_TTL_MS, HubAuth } from "./hub-auth.js";

const secret = "a-secret-that-is-long-enough";

describe("HubAuth without a password", () => {
  const auth = new HubAuth({ password: "", secret });

  it("is not required and lets everything through", () => {
    expect(auth.required).toBe(false);
    expect(auth.verify(undefined)).toBe(true);
    expect(auth.checkPassword("anything")).toBe(true);
  });
});

describe("HubAuth with a password", () => {
  const auth = new HubAuth({ password: "hunter2", secret });

  it("checks the password", () => {
    expect(auth.required).toBe(true);
    expect(auth.checkPassword("hunter2")).toBe(true);
    expect(auth.checkPassword("hunter3")).toBe(false);
    expect(auth.checkPassword("")).toBe(false);
  });

  it("accepts a pass it issued until it expires", () => {
    const now = 1_000_000;
    const { value, expiresAt } = auth.issue(now);
    expect(expiresAt).toBe(now + HUB_AUTH_TTL_MS);
    expect(auth.verify(value, now + 1)).toBe(true);
    expect(auth.verify(value, expiresAt)).toBe(false);
  });

  it("refuses a missing, malformed or tampered pass", () => {
    const { value } = auth.issue();
    expect(auth.verify(undefined)).toBe(false);
    expect(auth.verify("")).toBe(false);
    expect(auth.verify("v1.x.y")).toBe(false);
    expect(auth.verify(value.replace(/^v1/, "v2"))).toBe(false);
    // Pushing the expiry out breaks the MAC.
    const [v, exp, nonce, mac] = value.split(".");
    expect(auth.verify(`${v}.${Number(exp) + 1000}.${nonce}.${mac}`)).toBe(false);
    expect(auth.verify(`${value}x`)).toBe(false);
  });

  it("signs everyone out when the password or the secret changes", () => {
    const { value } = auth.issue();
    expect(new HubAuth({ password: "changed", secret }).verify(value)).toBe(false);
    expect(new HubAuth({ password: "hunter2", secret: `${secret}!` }).verify(value)).toBe(false);
    expect(new HubAuth({ password: "hunter2", secret }).verify(value)).toBe(true);
  });
});
