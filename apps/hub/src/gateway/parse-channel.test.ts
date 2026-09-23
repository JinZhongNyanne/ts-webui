import { describe, expect, it } from "vitest";
import { channelFromParams, channelPatchFromParams } from "./parse.js";

/** notifychannelcreated as a live TS3 3.13 server sends it: defaults are left out. */
const CREATED = {
  cid: "229",
  cpid: "225",
  channel_name: "probe-c",
  channel_order: "226",
  channel_flag_semi_permanent: "1",
  invokerid: "673",
};

describe("channelFromParams", () => {
  it("fills what a created notify leaves out with the server's defaults", () => {
    const ch = channelFromParams(CREATED);
    expect(ch.codec).toBe(4);
    expect(ch.codecQuality).toBe(5);
    expect(ch.maxClients).toBe(-1);
    expect(ch.flags.maxClientsUnlimited).toBe(true);
    expect(ch.flags.maxFamilyClientsUnlimited).toBe(true);
    expect(ch.flags.maxFamilyClientsInherited).toBe(false);
    expect(ch.namePhonetic).toBe("");
    expect(ch.deleteDelay).toBe(0);
  });

  it("reads phonetic name, delete delay and explicit limits", () => {
    const ch = channelFromParams({
      ...CREATED,
      channel_name_phonetic: "phon",
      channel_delete_delay: "60",
      channel_maxclients: "5",
      channel_flag_maxclients_unlimited: "0",
    });
    expect(ch.namePhonetic).toBe("phon");
    expect(ch.deleteDelay).toBe(60);
    expect(ch.maxClients).toBe(5);
    expect(ch.flags.maxClientsUnlimited).toBe(false);
  });
});

describe("channelPatchFromParams", () => {
  it("reads the new place from notifychannelmoved (`order`, not `channel_order`)", () => {
    expect(
      channelPatchFromParams({
        cid: "228",
        cpid: "227",
        order: "0",
        reasonid: "1",
        invokerid: "9",
      }),
    ).toEqual({ parentId: "227", order: "0" });
  });

  it("reads an order change from notifychanneledited", () => {
    expect(channelPatchFromParams({ cid: "240", reasonid: "10", channel_order: "241" })).toEqual({
      order: "241",
    });
  });

  it("patches phonetic name and delete delay", () => {
    expect(
      channelPatchFromParams({ cid: "1", channel_name_phonetic: "p", channel_delete_delay: "30" }),
    ).toEqual({ namePhonetic: "p", deleteDelay: 30 });
  });
});
