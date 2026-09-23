import { describe, expect, it } from "vitest";
import { createChannelPasswords } from "./channel-passwords";

describe("channel passwords", () => {
  it("knows nothing at first", () => {
    const pw = createChannelPasswords();
    expect(pw.get("5")).toBe("");
  });

  it("remembers a password the server accepted, and forgets it on request", () => {
    const pw = createChannelPasswords();
    pw.remember("5", "right");
    expect(pw.get("5")).toBe("right");
    pw.remember("5", "");
    expect(pw.get("5")).toBe("right");
    pw.forget("5");
    expect(pw.get("5")).toBe("");
  });

  it("keeps a move's password only once we are in the channel", () => {
    const pw = createChannelPasswords();
    pw.expectMove("5", "guess");
    expect(pw.get("5")).toBe("");
    pw.arrived("7"); // somewhere else first: still waiting
    expect(pw.get("7")).toBe("");
    pw.arrived("5");
    expect(pw.get("5")).toBe("guess");
  });

  it("never keeps the password of a move the server refused", () => {
    const pw = createChannelPasswords();
    pw.remember("5", "right");
    pw.expectMove("5", "wrong");
    // Refused: we stay where we are, and the next move replaces the guess.
    pw.expectMove("6");
    pw.arrived("6");
    pw.arrived("5");
    expect(pw.get("5")).toBe("right");
  });

  it("keeps a connect's channel password for the channel we land in, if it has one", () => {
    const pw = createChannelPasswords();
    pw.expectJoin("default pw");
    pw.landed("9", true);
    expect(pw.get("9")).toBe("default pw");

    // A wrong password lands us in the server's default channel, which has none.
    const other = createChannelPasswords();
    other.expectJoin("wrong");
    other.landed("1", false);
    expect(other.get("1")).toBe("");
  });

  it("forgets everything on clear", () => {
    const pw = createChannelPasswords();
    pw.remember("5", "x");
    pw.expectMove("6", "y");
    pw.clear();
    pw.arrived("6");
    expect(pw.get("5")).toBe("");
    expect(pw.get("6")).toBe("");
  });

  it("is reactive for the listing's password prompt", () => {
    const pw = createChannelPasswords();
    const before = pw.known.value;
    pw.remember("5", "x");
    expect(pw.known.value).not.toBe(before);
    expect(before.size).toBe(0);
  });
});
