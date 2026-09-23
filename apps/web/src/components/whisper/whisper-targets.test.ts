import { describe, expect, it } from "vitest";
import { WHISPER_MAX_TARGETS } from "@jinz/protocol";
import {
  EMPTY_WHISPER_LIST,
  isWhisperListEmpty,
  resolveWhisperTargets,
  type WhisperTree,
} from "./whisper-targets";

/*
 * 1 Lobby
 *   2 Games
 *     4 Raid
 *       5 Raid A
 *   3 Music
 * 6 AFK
 */
const channels = [
  { id: "1", parentId: "0" },
  { id: "2", parentId: "1" },
  { id: "3", parentId: "1" },
  { id: "4", parentId: "2" },
  { id: "5", parentId: "4" },
  { id: "6", parentId: "0" },
];
const client = (id: number, channelId: string, over: Partial<WhisperTree["clients"][0]> = {}) => ({
  id,
  uid: `uid${id}`,
  channelId,
  isChannelCommander: false,
  isSelf: false,
  ...over,
});
const tree = (selfChannelId: string, extra: WhisperTree["clients"] = []): WhisperTree => ({
  channels,
  selfChannelId,
  clients: [client(1, selfChannelId, { isSelf: true }), ...extra],
});

describe("resolveWhisperTargets presets", () => {
  it("current channel", () => {
    const r = resolveWhisperTargets({ ...EMPTY_WHISPER_LIST, presets: ["channel"] }, tree("4"));
    expect(r).toEqual({ channels: ["4"], clients: [], truncated: false });
  });

  it("parent channel, and nothing at the top level", () => {
    const list = { ...EMPTY_WHISPER_LIST, presets: ["parent" as const] };
    expect(resolveWhisperTargets(list, tree("4")).channels).toEqual(["2"]);
    expect(resolveWhisperTargets(list, tree("1")).channels).toEqual([]);
  });

  it("all parent channels, nearest first", () => {
    const list = { ...EMPTY_WHISPER_LIST, presets: ["parents" as const] };
    expect(resolveWhisperTargets(list, tree("5")).channels).toEqual(["4", "2", "1"]);
  });

  it("subchannels: the direct children only", () => {
    const list = { ...EMPTY_WHISPER_LIST, presets: ["subchannels" as const] };
    expect(resolveWhisperTargets(list, tree("1")).channels).toEqual(["2", "3"]);
  });

  it("channel family: the channel and everything below it", () => {
    const list = { ...EMPTY_WHISPER_LIST, presets: ["family" as const] };
    expect(resolveWhisperTargets(list, tree("2")).channels).toEqual(["2", "4", "5"]);
  });

  it("all channels", () => {
    const list = { ...EMPTY_WHISPER_LIST, presets: ["all" as const] };
    expect(resolveWhisperTargets(list, tree("2")).channels).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("channel commanders anywhere, never ourselves", () => {
    const others = [
      client(7, "6", { isChannelCommander: true }),
      client(8, "2"),
      client(9, "3", { isChannelCommander: true }),
    ];
    const t = tree("1", others);
    t.clients[0] = { ...t.clients[0]!, isChannelCommander: true };
    const list = { ...EMPTY_WHISPER_LIST, presets: ["commanders" as const] };
    expect(resolveWhisperTargets(list, t).clients).toEqual([7, 9]);
  });
});

describe("resolveWhisperTargets explicit targets", () => {
  it("keeps explicit channels in the tree and maps client uids to who is online now", () => {
    const list = { presets: [], channels: ["3", "99"], clients: ["uid8", "uidGone", "uid1"] };
    const r = resolveWhisperTargets(list, tree("1", [client(8, "2")]));
    expect(r).toEqual({ channels: ["3"], clients: [8], truncated: false });
  });

  it("does not name a channel twice when a preset and the list overlap", () => {
    const list = { presets: ["channel" as const, "family" as const], channels: ["2"], clients: [] };
    expect(resolveWhisperTargets(list, tree("2")).channels).toEqual(["2", "4", "5"]);
  });

  it("stops at the anti-flood cap and says so", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: String(100 + i), parentId: "0" }));
    const t: WhisperTree = { ...tree("1"), channels: [...channels, ...many] };
    const r = resolveWhisperTargets({ ...EMPTY_WHISPER_LIST, presets: ["all"] }, t);
    expect(r.channels).toHaveLength(WHISPER_MAX_TARGETS);
    expect(r.truncated).toBe(true);
  });

  it("resolves nothing when not in a channel", () => {
    const t: WhisperTree = { ...tree("1"), selfChannelId: null };
    const r = resolveWhisperTargets({ ...EMPTY_WHISPER_LIST, presets: ["channel", "parent"] }, t);
    expect(r).toEqual({ channels: [], clients: [], truncated: false });
  });
});

describe("isWhisperListEmpty", () => {
  it("tells an empty list", () => {
    expect(isWhisperListEmpty(EMPTY_WHISPER_LIST)).toBe(true);
    expect(isWhisperListEmpty({ ...EMPTY_WHISPER_LIST, clients: ["x"] })).toBe(false);
  });
});
