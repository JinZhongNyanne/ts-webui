import { describe, expect, it } from "vitest";
import { TsCmdRequestSchema, TS_CMD_NAMES } from "./ts-commands.js";

const cmd = (name: string, args: unknown) => ({ type: "ts.cmd", id: "c1", cmd: name, args });
const ok = (name: string, args: unknown) => TsCmdRequestSchema.safeParse(cmd(name, args)).success;

describe("channel description size", () => {
  // A live TS3 3.13 server takes 8192 bytes (8190 in CJK passed, 8193 got 1541)
  // and gives no answer at all once the escaped command grows past about 9 KB.
  it("is held to the server's byte limit, not just its character count", () => {
    const edit = (d: string) => ok("channeledit", { cid: "5", channel_description: d });
    expect(edit("x".repeat(8192))).toBe(true);
    expect(edit("汉".repeat(2730))).toBe(true);
    expect(edit("汉".repeat(2731))).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_description: "汉".repeat(2731) })).toBe(
      false,
    );
  });

  it("counts the escaping: spaces and newlines go out as two bytes", () => {
    const edit = (d: string) => ok("channeledit", { cid: "5", channel_description: d });
    expect(edit("a ".repeat(3000))).toBe(true);
    expect(edit("a ".repeat(4096))).toBe(false);
  });
});

describe("channel commands (M2)", () => {
  it("are on the allow list", () => {
    for (const name of [
      "channelcreate",
      "channeledit",
      "channeldelete",
      "channelmove",
      "channeladdperm",
      "channeldelperm",
    ]) {
      expect(TS_CMD_NAMES).toContain(name);
    }
  });

  it("channelcreate needs a name and takes the channel properties", () => {
    expect(ok("channelcreate", { channel_name: "Lobby" })).toBe(true);
    expect(ok("channelcreate", { cpid: "5", channel_name: "Sub" })).toBe(true);
    expect(ok("channelcreate", { cpid: "5" })).toBe(false);
    expect(ok("channelcreate", { channel_name: "   " })).toBe(false);
    expect(ok("channelcreate", { channel_name: "x".repeat(41) })).toBe(false);
    expect(
      ok("channelcreate", {
        cpid: "5",
        channel_name: "Sub",
        channel_name_phonetic: "sub",
        channel_topic: "t",
        channel_description: "[b]hi[/b]",
        channel_password: "pw",
        channel_codec: 5,
        channel_codec_quality: 10,
        channel_maxclients: 5,
        channel_flag_maxclients_unlimited: false,
        channel_maxfamilyclients: 9,
        channel_flag_maxfamilyclients_unlimited: false,
        channel_flag_maxfamilyclients_inherited: false,
        channel_flag_permanent: false,
        channel_flag_semi_permanent: true,
        channel_flag_default: false,
        channel_needed_talk_power: 3,
        channel_order: "7",
        channel_delete_delay: 60,
      }),
    ).toBe(true);
  });

  it("refuses unknown fields and bad values", () => {
    expect(ok("channelcreate", { channel_name: "a", channel_icon_id: 5 })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", cpid: "1 cid=2" })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_codec_quality: 11 })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_maxclients: -2 })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_delete_delay: -1 })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_flag_default: "1" })).toBe(false);
  });

  it("only sends the Opus codecs (the legacy ones are read-only)", () => {
    expect(ok("channelcreate", { channel_name: "a", channel_codec: 4 })).toBe(true);
    expect(ok("channelcreate", { channel_name: "a", channel_codec: 0 })).toBe(false);
    expect(ok("channelcreate", { channel_name: "a", channel_codec: 3 })).toBe(false);
  });

  it("channeledit needs a cid and something to change", () => {
    expect(ok("channeledit", { cid: "5", channel_topic: "" })).toBe(true);
    expect(ok("channeledit", { cid: "5", channel_password: "" })).toBe(true);
    expect(ok("channeledit", { cid: "5" })).toBe(false);
    expect(ok("channeledit", { channel_topic: "x" })).toBe(false);
    expect(ok("channeledit", { cid: "5", cpid: "3" })).toBe(false);
  });

  it("channeldelete and channelmove", () => {
    expect(ok("channeldelete", { cid: "5", force: true })).toBe(true);
    expect(ok("channeldelete", { cid: "5" })).toBe(false);
    expect(ok("channelmove", { cid: "5", cpid: "0" })).toBe(true);
    expect(ok("channelmove", { cid: "5", cpid: "3", order: "0" })).toBe(true);
    expect(ok("channelmove", { cid: "5", cpid: "x" })).toBe(false);
  });

  it("channel permissions are limited to the icon for now", () => {
    expect(ok("channeladdperm", { cid: "5", permsid: "i_icon_id", permvalue: 12345 })).toBe(true);
    expect(ok("channeladdperm", { cid: "5", permsid: "i_icon_id", permvalue: 4294967295 })).toBe(
      true,
    );
    expect(
      ok("channeladdperm", { cid: "5", permsid: "i_channel_needed_join_power", permvalue: 1 }),
    ).toBe(false);
    expect(ok("channeldelperm", { cid: "5", permsid: "i_icon_id" })).toBe(true);
    expect(ok("channeldelperm", { cid: "5", permsid: "b_x" })).toBe(false);
  });
});
