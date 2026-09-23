import { describe, expect, it } from "vitest";
import { mayTalk } from "./talk-power";

const me = (
  talkPower: number,
  over: { isTalker?: boolean; isChannelCommander?: boolean } = {},
) => ({
  talkPower,
  isTalker: over.isTalker ?? false,
  isChannelCommander: over.isChannelCommander ?? false,
});
const channel = (neededTalkPower: number) => ({ neededTalkPower });

describe("mayTalk", () => {
  it("lets anyone talk in a channel that asks for no talk power", () => {
    expect(mayTalk(me(0), channel(0))).toBe(true);
  });

  it("needs at least the channel's talk power", () => {
    expect(mayTalk(me(49), channel(50))).toBe(false);
    expect(mayTalk(me(50), channel(50))).toBe(true);
    expect(mayTalk(me(75), channel(50))).toBe(true);
  });

  it("lets a talker talk whatever their power (a granted talk request)", () => {
    expect(mayTalk(me(0, { isTalker: true }), channel(50))).toBe(true);
  });

  it("gives a channel commander no talk power of their own", () => {
    expect(mayTalk(me(0, { isChannelCommander: true }), channel(50))).toBe(false);
  });

  it("does not gate before there is a client or a channel to judge by", () => {
    expect(mayTalk(null, channel(50))).toBe(true);
    expect(mayTalk(me(0), null)).toBe(true);
  });
});
