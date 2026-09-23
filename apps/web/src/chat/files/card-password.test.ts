import { describe, expect, it } from "vitest";
import { passwordPlan } from "./card-password";

const open = { flags: { password: false } };
const locked = { flags: { password: true } };

describe("file card password plan", () => {
  it("says the channel is gone when the link names one we cannot see", () => {
    expect(passwordPlan(undefined, "")).toEqual({ kind: "gone" });
  });

  it("goes ahead for a channel without a password", () => {
    expect(passwordPlan(open, "")).toEqual({ kind: "use" });
  });

  it("asks only when nothing is known for a channel that has one", () => {
    expect(passwordPlan(locked, "")).toEqual({ kind: "ask" });
    expect(passwordPlan(locked, "known")).toEqual({ kind: "use" });
  });
});
