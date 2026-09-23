import { describe, expect, it } from "vitest";
import { applyToProfile, formFromProfile, formFromRecent } from "./form";

const profile = {
  host: "ts.example.com",
  port: 9987,
  nickname: "m1id-typed",
  serverPassword: "pw",
  defaultChannel: "Lobby",
  musicBot: "",
  defaultChannelPassword: "cpw",
};

describe("bookmark forms", () => {
  it("prefers the channel we are in over the one we started in", () => {
    expect(formFromProfile(profile, "i", "Games/Room")).toMatchObject({
      defaultChannel: "Games/Room",
      channelPassword: "",
      serverPassword: "pw",
      identityId: "i",
      label: "ts.example.com",
    });
    expect(formFromProfile(profile, null)).toMatchObject({
      defaultChannel: "Lobby",
      channelPassword: "cpw",
    });
  });

  it("applies a bookmark but keeps the typed nickname when it has none", () => {
    const f = { ...formFromProfile(profile, null), host: "other", nickname: "" };
    const next = applyToProfile(profile, f);
    expect(next).toMatchObject({ host: "other", nickname: "m1id-typed" });
    expect(profile.host).toBe("ts.example.com");
    expect(applyToProfile(profile, { ...f, nickname: "m1id-bm" }).nickname).toBe("m1id-bm");
  });

  it("recent entries carry no passwords", () => {
    const f = formFromRecent({ ...profile, identityId: null, at: 1 });
    expect(f.serverPassword).toBe("");
    expect(f.channelPassword).toBe("");
  });
});
