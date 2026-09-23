import { describe, expect, it } from "vitest";
import {
  channelFromParams,
  channelPatchFromParams,
  clientFromParams,
  clientPatchFromParams,
  groupFromParams,
  serverPatchFromParams,
} from "./parse.js";

/**
 * Icon ids above 2^31 are negative int32 permissions; a live TS3 3.13 server
 * sent this one (set as -873187034) in notifychanneledited as a sign-extended
 * uint64, which a plain Number() cannot hold exactly.
 */
const WIDE = "18446744072836364582";
const ICON = 3421780262;

describe("icon ids", () => {
  it("come out as the unsigned 32-bit id, however the server wrote them", () => {
    expect(channelPatchFromParams({ cid: "5", channel_icon_id: WIDE }).iconId).toBe(ICON);
    expect(channelPatchFromParams({ cid: "5", channel_icon_id: "-873187034" }).iconId).toBe(ICON);
    expect(channelPatchFromParams({ cid: "5", channel_icon_id: String(ICON) }).iconId).toBe(ICON);
    expect(channelFromParams({ cid: "5", channel_icon_id: WIDE }).iconId).toBe(ICON);
    expect(clientPatchFromParams({ clid: "7", client_icon_id: WIDE }).iconId).toBe(ICON);
    expect(clientFromParams({ clid: "7", client_icon_id: "-873187034" }, 1).iconId).toBe(ICON);
    expect(serverPatchFromParams({ virtualserver_icon_id: WIDE }).iconId).toBe(ICON);
    expect(groupFromParams({ sgid: "9", name: "g", iconid: "-873187034" })?.iconId).toBe(ICON);
  });

  it("keep small and missing ids as they are", () => {
    expect(channelPatchFromParams({ cid: "5", channel_icon_id: "0" }).iconId).toBe(0);
    expect(groupFromParams({ sgid: "9", name: "g", iconid: "500" })?.iconId).toBe(500);
    expect(channelFromParams({ cid: "5" }).iconId).toBe(0);
    expect(channelPatchFromParams({ cid: "5", channel_icon_id: "junk" }).iconId).toBe(0);
  });
});
