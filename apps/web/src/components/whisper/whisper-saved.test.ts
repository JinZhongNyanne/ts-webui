import { describe, expect, it } from "vitest";
import { historyServerKey } from "../../chat/history";
import { resolveWhisperTargets, type WhisperTree } from "./whisper-targets";
import {
  EMPTY_SAVED_WHISPER_LIST,
  sanitiseSavedWhisperList,
  saveWhisperList,
  whisperListFor,
  whisperServerKey,
  type SavedWhisperList,
} from "./whisper-saved";

const A = "a.example:9987#1111";
const B = "b.example:9987#2222";

const saved = (over: Partial<SavedWhisperList> = {}): SavedWhisperList => ({
  ...EMPTY_SAVED_WHISPER_LIST,
  ...over,
});

/** Server B's tree: it has a channel 5 too, which is not the "5" picked on A. */
const treeB: WhisperTree = {
  channels: [
    { id: "1", parentId: "0" },
    { id: "5", parentId: "0" },
    { id: "7", parentId: "0" },
  ],
  clients: [{ id: 1, uid: "me", channelId: "1", isChannelCommander: false, isSelf: true }],
  selfChannelId: "1",
};

describe("whisperServerKey", () => {
  const target = { host: "A.example", port: 9987, fixed: false };

  it("is the chat history's key for the server we are on", () => {
    const server = { created: 1111, name: "A" };
    expect(whisperServerKey(server, target)).toBe(historyServerKey(server, target));
  });

  it("is null while not on a server", () => {
    expect(whisperServerKey(null, target)).toBeNull();
  });
});

describe("whisperListFor", () => {
  it("names only the current server's hand-picked channels", () => {
    const list = saved({
      presets: ["channel"],
      clients: ["uid8"],
      channelsByServer: { [A]: ["5"] },
    });
    expect(whisperListFor(list, A)).toEqual({
      presets: ["channel"],
      channels: ["5"],
      clients: ["uid8"],
    });
    expect(whisperListFor(list, B)).toEqual({
      presets: ["channel"],
      channels: [],
      clients: ["uid8"],
    });
  });

  it("names no hand-picked channel while not on a server", () => {
    expect(whisperListFor(saved({ channelsByServer: { [A]: ["5"] } }), null).channels).toEqual([]);
  });

  it("never mistakes an inherited property for a server's picks", () => {
    expect(whisperListFor(saved(), "constructor").channels).toEqual([]);
    expect(whisperListFor(saved(), "__proto__").channels).toEqual([]);
  });

  it("never lets another server's pick resolve, even to a channel of the same id", () => {
    const list = saved({ channelsByServer: { [A]: ["5"] } });
    expect(resolveWhisperTargets(whisperListFor(list, B), treeB).channels).toEqual([]);
    expect(resolveWhisperTargets(whisperListFor(list, A), treeB).channels).toEqual(["5"]);
  });
});

describe("saveWhisperList", () => {
  it("files hand-picked channels under the current server and leaves the others' alone", () => {
    const before = saved({ channelsByServer: { [A]: ["5"] } });
    const after = saveWhisperList(before, B, { presets: [], channels: ["7"], clients: [] });
    expect(after.channelsByServer).toEqual({ [A]: ["5"], [B]: ["7"] });
    expect(before.channelsByServer).toEqual({ [A]: ["5"] });
  });

  it("forgets a server once its last pick is removed", () => {
    const before = saved({ channelsByServer: { [A]: ["5"], [B]: ["7"] } });
    const after = saveWhisperList(before, B, { presets: [], channels: [], clients: [] });
    expect(after.channelsByServer).toEqual({ [A]: ["5"] });
  });

  it("takes presets and people as they are: they mean the same on every server", () => {
    const after = saveWhisperList(saved(), A, {
      presets: ["family"],
      channels: [],
      clients: ["uid9"],
    });
    expect(after).toEqual({ presets: ["family"], channelsByServer: {}, clients: ["uid9"] });
  });

  it("cannot file a channel while not on a server", () => {
    const before = saved({ channelsByServer: { [A]: ["5"] } });
    const after = saveWhisperList(before, null, {
      presets: ["channel"],
      channels: ["9"],
      clients: [],
    });
    expect(after).toEqual({ presets: ["channel"], channelsByServer: { [A]: ["5"] }, clients: [] });
  });
});

describe("sanitiseSavedWhisperList", () => {
  it("keeps only well-formed fields from saved data", () => {
    expect(sanitiseSavedWhisperList(null)).toEqual(EMPTY_SAVED_WHISPER_LIST);
    expect(sanitiseSavedWhisperList("junk")).toEqual(EMPTY_SAVED_WHISPER_LIST);
    expect(
      sanitiseSavedWhisperList({
        presets: ["channel", "bogus", "channel", 3],
        channelsByServer: { [A]: ["12", "x", 5, "12"], [B]: "7", "": ["3"], [`${B}x`]: [] },
        clients: ["abc=", "", 7],
      }),
    ).toEqual({ presets: ["channel"], channelsByServer: { [A]: ["12"] }, clients: ["abc="] });
  });

  it("drops channels saved before they were filed by server rather than guess where they belong", () => {
    const migrated = sanitiseSavedWhisperList({
      presets: ["parent"],
      channels: ["5", "6"],
      clients: ["uid8"],
    });
    expect(migrated).toEqual({ presets: ["parent"], channelsByServer: {}, clients: ["uid8"] });
    expect(whisperListFor(migrated, A).channels).toEqual([]);
    expect(resolveWhisperTargets(whisperListFor(migrated, B), treeB).channels).toEqual([]);
  });

  it("reads back what it saved", () => {
    const list = saveWhisperList(saved(), A, {
      presets: ["all"],
      channels: ["5"],
      clients: ["uid8"],
    });
    const stored = JSON.parse(JSON.stringify(list)) as unknown;
    expect(sanitiseSavedWhisperList(stored)).toEqual(list);
  });
});
