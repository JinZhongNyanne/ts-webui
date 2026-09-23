import { describe, expect, it } from "vitest";
import { TsCmdRequestSchema, type TsCmdRequest } from "@jinz/protocol";
import { prepareTsCommand } from "./commands.js";
import { parseCommandLines } from "./raw.js";

function req(cmd: string, args: unknown): TsCmdRequest {
  return TsCmdRequestSchema.parse({ type: "ts.cmd", id: "r1", cmd, args });
}

const text = (cmd: string, args: unknown) => prepareTsCommand(req(cmd, args)).text;

describe("channel command builders", () => {
  it("sends channel passwords hashed, as joining does (checked on a live server)", () => {
    // Created with the plain text, a channel only let in a join that sent the
    // plain text too, which neither we nor the TeamSpeak client do.
    expect(text("channelcreate", { channel_name: "a", channel_password: "secret" })).toBe(
      "channelcreate channel_name=a channel_password=5en6G6MezRroT3XKqkdPOmY\\/BfQ=",
    );
    expect(text("channeledit", { cid: "5", channel_password: "pw2" })).toBe(
      "channeledit cid=5 channel_password=8Wyi36Noi\\/CMek4hVErxW9WYy3A=",
    );
  });

  it("channelcreate escapes texts and writes flags as 1/0 (in schema order)", () => {
    expect(
      text("channelcreate", {
        cpid: "5",
        channel_name: "My room",
        channel_password: "a|b",
        channel_flag_semi_permanent: true,
        channel_flag_maxclients_unlimited: false,
        channel_maxclients: 5,
      }),
    ).toBe(
      "channelcreate cpid=5 channel_name=My\\sroom channel_password=mr5t4kqHE2S\\/QSocMBaYte0w27c=" +
        " channel_maxclients=5" +
        " channel_flag_maxclients_unlimited=0 channel_flag_semi_permanent=1",
    );
  });

  it("a description cannot smuggle in parameters", () => {
    const t = text("channeledit", { cid: "5", channel_description: "x cid=1|channel_name=y" });
    const rows = parseCommandLines(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params).toEqual({ cid: "5", channel_description: "x cid=1|channel_name=y" });
  });

  it("channeledit keeps an empty password (it removes the password)", () => {
    expect(text("channeledit", { cid: "5", channel_password: "" })).toBe(
      "channeledit cid=5 channel_password=",
    );
  });

  it("channeldelete and channelmove", () => {
    expect(text("channeldelete", { cid: "5", force: true })).toBe("channeldelete cid=5 force=1");
    expect(text("channeldelete", { cid: "5", force: false })).toBe("channeldelete cid=5 force=0");
    expect(text("channelmove", { cid: "5", cpid: "2", order: "0" })).toBe(
      "channelmove cid=5 cpid=2 order=0",
    );
    expect(text("channelmove", { cid: "5", cpid: "2" })).toBe("channelmove cid=5 cpid=2");
  });

  it("sends icon ids above int32 as the signed value TeamSpeak stores", () => {
    expect(text("channeladdperm", { cid: "5", permsid: "i_icon_id", permvalue: 12345 })).toBe(
      "channeladdperm cid=5 permsid=i_icon_id permvalue=12345",
    );
    expect(text("channeladdperm", { cid: "5", permsid: "i_icon_id", permvalue: 4294967295 })).toBe(
      "channeladdperm cid=5 permsid=i_icon_id permvalue=-1",
    );
    expect(text("channeldelperm", { cid: "5", permsid: "i_icon_id" })).toBe(
      "channeldelperm cid=5 permsid=i_icon_id",
    );
  });
});
