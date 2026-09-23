import { describe, expect, it } from "vitest";
import { decodeTextCode } from "@jinz/protocol";
import { BANNED_CODE, selfBanNotice } from "./ban-notice.js";

describe("selfBanNotice", () => {
  it("names who banned us, why and for how long", () => {
    // As a live TS3 3.13 server sends it to the banned client itself.
    const notice = selfBanNotice({
      cfid: "1",
      ctid: "0",
      reasonid: "6",
      invokerid: "682",
      invokername: "Admin",
      reasonmsg: "probe banned",
      bantime: "60",
      clid: "683",
    });
    expect(notice?.code).toBe(BANNED_CODE);
    expect(decodeTextCode(notice!.message)).toEqual({
      key: "hub.bannedBy",
      params: { name: "Admin", reason: "probe banned", seconds: "60" },
    });
  });

  it("passes a permanent ban on as 0 seconds", () => {
    const notice = selfBanNotice({ reasonid: "6", invokername: "A", bantime: "0" });
    expect(decodeTextCode(notice!.message).params?.["seconds"]).toBe("0");
  });

  it("ignores every other way of leaving", () => {
    expect(selfBanNotice({ reasonid: "5", reasonmsg: "kick" })).toBeNull();
    expect(selfBanNotice({ reasonid: "8" })).toBeNull();
    expect(selfBanNotice({})).toBeNull();
  });
});
