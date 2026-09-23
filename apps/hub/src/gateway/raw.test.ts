import { describe, expect, it } from "vitest";
import { parseCommandLines, parseParams } from "./raw.js";
import {
  channelFromParams,
  clientFromParams,
  clientPatchFromParams,
  detectFlavor,
} from "./parse.js";

describe("parseCommandLines", () => {
  it("splits multi-row commands and unescapes values", () => {
    const text =
      "channellist cid=1 cpid=0 channel_name=Default\\sChannel channel_flag_default=1|cid=2 cpid=1 channel_name=Sub\\pChan";
    const rows = parseCommandLines(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe("channellist");
    expect(rows[0]!.params["channel_name"]).toBe("Default Channel");
    expect(rows[1]!.name).toBe("channellist");
    expect(rows[1]!.params["cid"]).toBe("2");
    expect(rows[1]!.params["channel_name"]).toBe("Sub|Chan");
  });

  it("handles multiple lines separated by NUL or newline", () => {
    const rows = parseCommandLines(
      "channellistfinished\0notifyclientmoved clid=5 ctid=3 reasonid=0\n",
    );
    expect(rows.map((r) => r.name)).toEqual(["channellistfinished", "notifyclientmoved"]);
    expect(rows[1]!.params).toEqual({ clid: "5", ctid: "3", reasonid: "0" });
  });

  it("propagates the shared channel context to later items of a batched enterview", () => {
    // TS3 writes cfid/ctid once for the whole batch; later clients only carry
    // their own fields and must inherit the channel.
    const text =
      "notifycliententerview cfid=0 ctid=7 reasonid=0 clid=3 client_nickname=Bot|clid=4 client_nickname=Me";
    const rows = parseCommandLines(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.params["ctid"]).toBe("7");
    expect(rows[1]!.params["ctid"]).toBe("7");
    expect(rows[1]!.params["clid"]).toBe("4");
    expect(rows[1]!.params["client_nickname"]).toBe("Me");
  });

  it("does not leak per-row list fields across channellist rows", () => {
    const text = "channellist cid=1 channel_topic=hi|cid=2 channel_name=Two";
    const rows = parseCommandLines(text);
    expect(rows[1]!.params["cid"]).toBe("2");
    expect(rows[1]!.params["channel_topic"]).toBeUndefined();
  });

  it("numbers the rows of each command, so a batch's first row can be told apart", () => {
    const rows = parseCommandLines(
      "notifyservergrouplist sgid=6 name=A|sgid=7 name=B\nnotifyservergrouplist sgid=8 name=C",
    );
    expect(rows.map((r) => [r.params["sgid"], r.segment])).toEqual([
      ["6", 0],
      ["7", 1],
      ["8", 0],
    ]);
  });

  it("treats flag tokens without '=' as empty strings", () => {
    expect(parseParams("clid=1 -uid -away")).toEqual({ clid: "1", "-uid": "", "-away": "" });
  });
});

describe("parse helpers", () => {
  it("builds a channel from channellist params", () => {
    const ch = channelFromParams({
      cid: "12",
      cpid: "3",
      channel_order: "0",
      channel_name: "Music",
      channel_codec: "5",
      channel_codec_quality: "10",
      channel_flag_permanent: "1",
      channel_maxclients: "-1",
      channel_flag_maxclients_unlimited: "1",
    });
    expect(ch.id).toBe("12");
    expect(ch.parentId).toBe("3");
    expect(ch.codec).toBe(5);
    expect(ch.flags.permanent).toBe(true);
    expect(ch.flags.maxClientsUnlimited).toBe(true);
    expect(ch.subscribed).toBe(false);
  });

  it("builds a client from notifycliententerview and marks self", () => {
    const c = clientFromParams(
      {
        clid: "7",
        ctid: "12",
        client_unique_identifier: "abc=",
        client_nickname: "Alice",
        client_servergroups: "6,8",
        client_input_muted: "1",
        client_type: "0",
      },
      7,
    );
    expect(c.isSelf).toBe(true);
    expect(c.channelId).toBe("12");
    expect(c.serverGroups).toEqual(["6", "8"]);
    expect(c.inputMuted).toBe(true);
    expect(c.outputHardware).toBe(true);
  });

  it("produces sparse patches", () => {
    expect(
      clientPatchFromParams({ clid: "7", client_away: "1", client_away_message: "brb" }),
    ).toEqual({
      away: true,
      awayMessage: "brb",
    });
  });

  it("detects server flavor", () => {
    expect(detectFlavor("3.13.7 [Build: 1655727713]", "Linux")).toBe("ts3");
    expect(detectFlavor("6.0.0-beta3", "Linux")).toBe("ts6");
    expect(detectFlavor("", "")).toBe("unknown");
  });
});
