import { describe, expect, it } from "vitest";
import { encodeTextCode, type ServerMessage, type TsClient } from "@jinz/protocol";
import {
  canTalk,
  cuesForMessage,
  EMPTY_CONTEXT,
  REASON,
  selfFlagCues,
  type ClientLite,
  type CueContext,
  type SelfFlags,
} from "./cues";

const SELF = 1;
const MINE = "10";
const OTHER = "20";

function ctx(clients: Record<number, Partial<ClientLite>> = {}, connected = true): CueContext {
  const map = new Map<number, ClientLite>();
  map.set(SELF, { channelId: MINE, nickname: "me", uid: "u1", isSelf: true });
  for (const [id, c] of Object.entries(clients)) {
    map.set(Number(id), {
      channelId: OTHER,
      nickname: `n${id}`,
      uid: `u${id}`,
      isSelf: false,
      ...c,
    });
  }
  return { selfId: SELF, selfChannelId: MINE, connected, clients: map };
}

function client(id: number, channelId: string, extra: Partial<TsClient> = {}): TsClient {
  return {
    id,
    uid: `u${id}`,
    databaseId: "0",
    nickname: `n${id}`,
    channelId,
    type: 0,
    inputMuted: false,
    outputMuted: false,
    inputHardware: true,
    outputHardware: true,
    away: false,
    awayMessage: "",
    talkPower: 0,
    isTalker: false,
    isPrioritySpeaker: false,
    isRecording: false,
    isChannelCommander: false,
    serverGroups: [],
    channelGroupId: "0",
    country: "",
    iconId: 0,
    badges: "",
    isSelf: false,
    ...extra,
  };
}

const events = (msg: ServerMessage, before: CueContext) =>
  cuesForMessage(msg, before).map((c) => c.event);

describe("connection cues", () => {
  it("chimes on connect", () => {
    expect(
      events(
        { type: "connected", selfClientId: 1, identity: "", uid: "", server: {} as never },
        EMPTY_CONTEXT,
      ),
    ).toEqual(["connected"]);
  });

  it("tells a requested disconnect from a lost connection", () => {
    expect(events({ type: "disconnected", reason: "", byUser: true }, ctx())).toEqual([
      "disconnected",
    ]);
    expect(events({ type: "disconnected", reason: "", byUser: false }, ctx())).toEqual([
      "connectionLost",
    ]);
  });

  it("stays quiet when a connect attempt fails before it was ever up", () => {
    expect(events({ type: "disconnected", reason: "", byUser: false }, ctx({}, false))).toEqual([]);
  });

  it("recognises being kicked from the server", () => {
    const kicked: ServerMessage = { type: "error", code: "kicked", message: "bye", fatal: true };
    expect(cuesForMessage(kicked, ctx())).toEqual([{ event: "kickedFromServer", text: "bye" }]);
    expect(events({ type: "error", code: "other", message: "x" }, ctx())).toEqual([]);
  });

  it("recognises being banned, naming who did it and why", () => {
    const message = encodeTextCode("hub.bannedBy", {
      name: "Admin",
      reason: "spam",
      seconds: "60",
    });
    const banned: ServerMessage = { type: "error", code: "banned", message, fatal: true };
    expect(cuesForMessage(banned, ctx())).toEqual([
      { event: "banned", name: "Admin", text: "spam" },
    ]);
  });

  it("leaves out an empty ban reason and invoker", () => {
    const message = encodeTextCode("hub.bannedBy", { name: "", reason: "", seconds: "0" });
    expect(cuesForMessage({ type: "error", code: "banned", message, fatal: true }, ctx())).toEqual([
      { event: "banned" },
    ]);
  });

  it("stays quiet about a ban notice when not connected", () => {
    const message = encodeTextCode("hub.bannedBy", { name: "A", reason: "", seconds: "0" });
    expect(events({ type: "error", code: "banned", message, fatal: true }, ctx({}, false))).toEqual(
      [],
    );
  });
});

describe("people cues", () => {
  it("separates joining our channel from joining the server", () => {
    expect(events({ type: "client.entered", client: client(5, MINE) }, ctx())).toEqual([
      "channelUserJoined",
    ]);
    expect(events({ type: "client.entered", client: client(5, OTHER) }, ctx())).toEqual([
      "serverUserJoined",
    ]);
  });

  it("never announces ourselves", () => {
    expect(
      events({ type: "client.entered", client: client(SELF, MINE, { isSelf: true }) }, ctx()),
    ).toEqual([]);
  });

  it("uses the pre-message model for a departure (the ts store already dropped them)", () => {
    const before = ctx({ 5: { channelId: MINE }, 6: { channelId: OTHER } });
    const left = (id: number): ServerMessage => ({
      type: "client.left",
      clientId: id,
      reasonId: REASON.leftServer,
      reasonMsg: "",
    });
    expect(cuesForMessage(left(5), before)).toEqual([
      { event: "channelUserLeft", name: "n5", uid: "u5" },
    ]);
    expect(events(left(6), before)).toEqual(["serverUserLeft"]);
    expect(events(left(99), before)).toEqual([]);
  });

  it("stays quiet when users only come into or drop out of view", () => {
    const before = ctx({ 5: { channelId: OTHER } });
    expect(
      events({ type: "client.entered", client: client(6, OTHER), joinedServer: false }, before),
    ).toEqual([]);
    expect(
      events({ type: "client.entered", client: client(6, OTHER), joinedServer: true }, before),
    ).toEqual(["serverUserJoined"]);
    // Reason 0: an unsubscribe (or a move into a channel we don't see).
    expect(
      events({ type: "client.left", clientId: 5, reasonId: 0, reasonMsg: "" }, before),
    ).toEqual([]);
    for (const reasonId of [REASON.timeout, REASON.serverKick, REASON.ban]) {
      expect(events({ type: "client.left", clientId: 5, reasonId, reasonMsg: "" }, before)).toEqual(
        ["serverUserLeft"],
      );
    }
  });

  it("treats moves across our channel boundary as joins and leaves", () => {
    const before = ctx({
      5: { channelId: OTHER },
      6: { channelId: MINE },
      7: { channelId: OTHER },
    });
    const move = (id: number, to: string): ServerMessage => ({
      type: "client.moved",
      clientId: id,
      channelId: to,
      reasonId: REASON.selfMove,
    });
    expect(events(move(5, MINE), before)).toEqual(["channelUserJoined"]);
    expect(events(move(6, OTHER), before)).toEqual(["channelUserLeft"]);
    expect(events(move(7, "30"), before)).toEqual([]);
  });
});

describe("cues about ourselves", () => {
  const moveSelf = (reasonId: number): ServerMessage => ({
    type: "client.moved",
    clientId: SELF,
    channelId: OTHER,
    reasonId,
    invokerId: 9,
    invokerName: "admin",
  });

  it("ignores our own channel switch", () => {
    expect(events(moveSelf(REASON.selfMove), ctx())).toEqual([]);
  });

  it("reports being moved or kicked, with who did it", () => {
    expect(cuesForMessage(moveSelf(REASON.movedByOther), ctx())).toEqual([
      { event: "movedByOther", name: "admin" },
    ]);
    expect(events(moveSelf(REASON.channelKick), ctx())).toEqual(["kickedFromChannel"]);
  });
});

describe("chat cues", () => {
  const text = (targetMode: 1 | 2 | 3, invokerId = 5): ServerMessage => ({
    type: "text",
    targetMode,
    targetId: "0",
    invokerId,
    invokerName: "bob",
    invokerUid: "ub",
    message: "hi",
    at: 0,
  });

  it("maps target modes to message kinds and conversations", () => {
    expect(cuesForMessage(text(1), ctx())[0]).toMatchObject({
      event: "privateMessage",
      conversation: "client:5",
      name: "bob",
      text: "hi",
    });
    expect(cuesForMessage(text(2), ctx())[0]).toMatchObject({
      event: "channelMessage",
      conversation: `channel:${MINE}`,
    });
    expect(cuesForMessage(text(3), ctx())[0]).toMatchObject({
      event: "serverMessage",
      conversation: "server",
    });
  });

  it("stays quiet for our own echo", () => {
    expect(events(text(1, SELF), ctx())).toEqual([]);
  });

  it("carries the poke text", () => {
    expect(
      cuesForMessage(
        { type: "poked", invokerId: 5, invokerName: "bob", message: "look", at: 0 },
        ctx(),
      ),
    ).toEqual([{ event: "poked", name: "bob", text: "look" }]);
  });
});

describe("selfFlagCues", () => {
  const base: SelfFlags = {
    clientId: SELF,
    channelId: MINE,
    inputMuted: false,
    outputMuted: false,
    away: false,
    canTalk: true,
  };

  it("reports each toggled flag", () => {
    expect(selfFlagCues(base, { ...base, inputMuted: true }).map((c) => c.event)).toEqual([
      "micMuted",
    ]);
    expect(selfFlagCues({ ...base, outputMuted: true }, base).map((c) => c.event)).toEqual([
      "speakersUnmuted",
    ]);
    expect(
      selfFlagCues(base, { ...base, away: true, inputMuted: true }).map((c) => c.event),
    ).toEqual(["micMuted", "awayOn"]);
  });

  it("says nothing across a connect, disconnect or new session", () => {
    expect(selfFlagCues(null, { ...base, inputMuted: true })).toEqual([]);
    expect(selfFlagCues(base, null)).toEqual([]);
    expect(selfFlagCues(base, { ...base, clientId: 2, inputMuted: true })).toEqual([]);
  });

  it("counts talk power changes only within one channel", () => {
    expect(selfFlagCues(base, { ...base, canTalk: false }).map((c) => c.event)).toEqual([
      "talkPowerRevoked",
    ]);
    expect(selfFlagCues({ ...base, canTalk: false }, base).map((c) => c.event)).toEqual([
      "talkPowerGranted",
    ]);
    expect(selfFlagCues(base, { ...base, channelId: OTHER, canTalk: false })).toEqual([]);
  });
});

describe("canTalk", () => {
  it("follows TS3: talker flag or enough talk power", () => {
    expect(canTalk(0, false, 0)).toBe(true);
    expect(canTalk(10, false, 50)).toBe(false);
    expect(canTalk(10, true, 50)).toBe(true);
    expect(canTalk(50, false, 50)).toBe(true);
  });
});
