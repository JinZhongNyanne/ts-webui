import { describe, expect, it } from "vitest";
import { allowsAction, parseBotSession } from "./permissions";
import type { BotSession, MusicAction } from "./permissions";

const ALL: MusicAction[] = [
  "add",
  "playNext",
  "playNow",
  "transport",
  "skip",
  "playMode",
  "removeClear",
  "prev",
  "playAt",
  "fm",
  "playCollection",
  "queueCollection",
];

function allowed(session: BotSession | null): MusicAction[] {
  return ALL.filter((a) => allowsAction(session, a));
}

/** The live response from the user's bot for an unauthenticated visitor. */
const openGuest: BotSession = {
  id: "__guest__",
  username: "游客",
  role: "guest",
  capabilities: [],
  bots: "all",
  guest: {
    addToQueue: true,
    playNext: true,
    playNow: true,
    skip: true,
    transport: true,
    removeClear: true,
    playMode: true,
    playCollection: true,
  },
};

describe("allowsAction", () => {
  it("lets a fully-permitted guest do everything except prev and play-at", () => {
    expect(allowed(openGuest)).toEqual([
      "add",
      "playNext",
      "playNow",
      "transport",
      "skip",
      "playMode",
      "removeClear",
      "fm",
      "playCollection",
    ]);
    // These routes have no guest flag in the bot at all.
    expect(allowsAction(openGuest, "prev")).toBe(false);
    expect(allowsAction(openGuest, "playAt")).toBe(false);
    // Queueing a whole playlist is capability-only, so a guest never may.
    expect(allowsAction(openGuest, "queueCollection")).toBe(false);
  });

  it("gates the discover controls on the flags the bot actually uses", () => {
    const noFm: BotSession = { ...openGuest, guest: { ...openGuest.guest, playMode: false } };
    // The bot guards /player/:id/fm with the playMode guest flag, not its own.
    expect(allowsAction(noFm, "fm")).toBe(false);
    const noCollection: BotSession = {
      ...openGuest,
      guest: { ...openGuest.guest, playCollection: false },
    };
    expect(allowsAction(noCollection, "playCollection")).toBe(false);
    expect(allowsAction(noCollection, "playNow")).toBe(true);

    const member: BotSession = {
      ...openGuest,
      role: "member",
      capabilities: ["player.queue"],
      guest: null,
    };
    expect(allowsAction(member, "queueCollection")).toBe(true);
    expect(allowsAction(member, "playCollection")).toBe(false);
  });

  it("takes a cleared guest flag away", () => {
    const strict: BotSession = { ...openGuest, guest: { ...openGuest.guest, transport: false } };
    expect(allowsAction(strict, "transport")).toBe(false);
    expect(allowsAction(strict, "add")).toBe(true);
    expect(allowsAction(strict, "skip")).toBe(true);
  });

  it("treats a missing guest flag as denied", () => {
    const bare: BotSession = { ...openGuest, guest: {} };
    expect(allowed(bare)).toEqual([]);
  });

  it("grants a member everything its capabilities cover, prev and play-at included", () => {
    const member: BotSession = {
      id: "u1",
      username: "mia",
      role: "member",
      capabilities: ["player.control", "player.queue"],
      bots: "all",
      guest: null,
    };
    expect(allowed(member)).toEqual(ALL);
  });

  it("limits a member to the capabilities it actually has", () => {
    const queueOnly: BotSession = {
      id: "u2",
      username: "leo",
      role: "member",
      capabilities: ["player.queue"],
      bots: "all",
      guest: null,
    };
    // player.queue covers the queue actions and nothing on the control side.
    expect(allowed(queueOnly)).toEqual(["add", "removeClear", "queueCollection"]);
  });

  it("gives an admin everything even with no capabilities listed", () => {
    const admin: BotSession = {
      id: "root",
      username: "root",
      role: "admin",
      capabilities: [],
      bots: "all",
      guest: null,
    };
    expect(allowed(admin)).toEqual(ALL);
  });

  it("allows everything while the session is unknown", () => {
    expect(allowed(null)).toEqual(ALL);
  });
});

describe("parseBotSession", () => {
  it("keeps a well-formed answer", () => {
    expect(parseBotSession(JSON.parse(JSON.stringify(openGuest)))).toEqual(openGuest);
  });

  it("rejects anything that is not a session", () => {
    expect(parseBotSession(null)).toBeNull();
    expect(parseBotSession("nope")).toBeNull();
    expect(parseBotSession({ role: "wizard" })).toBeNull();
  });

  it("defends against odd field types instead of trusting them", () => {
    const parsed = parseBotSession({
      role: "guest",
      capabilities: ["player.queue", 7],
      guest: { addToQueue: "yes", skip: true },
      bots: "all",
    });
    expect(parsed).toEqual({
      id: "",
      username: "",
      role: "guest",
      capabilities: ["player.queue"],
      bots: "all",
      guest: { addToQueue: false, skip: true },
    });
  });
});
