import { describe, expect, it } from "vitest";
import { avatarMatches, avatarPath, isAvatarHash, uidToAvatarName } from "./avatar.js";

describe("avatar file names", () => {
  it("writes the UID's bytes as a-p hex", () => {
    // Checked against a live TS3 server: an upload to this path, followed by
    // `clientupdate client_flag_avatar=<md5>`, is what other clients download.
    expect(uidToAvatarName("WtozSHmV+SHoGPMvMaG/Sc0mVSU=")).toBe(
      "fknkddeihjjfpjcboibipdcpdbkblpejmncgffcf",
    );
  });

  it("maps every nibble into a-p", () => {
    expect(uidToAvatarName(Buffer.from([0x00, 0x0f, 0xf0, 0xff]).toString("base64"))).toBe(
      "aaappapp",
    );
  });

  it("builds the internal path and refuses an empty UID", () => {
    expect(avatarPath("AAE=")).toBe("/avatar_aaab");
    expect(avatarPath("")).toBeNull();
  });
});

describe("avatarMatches", () => {
  const file = Buffer.from("abc");
  it("takes a file under its own MD5 only", () => {
    expect(avatarMatches(file, "900150983cd24fb0d6963f7d28e17f72")).toBe(true);
    expect(avatarMatches(file, "900150983CD24FB0D6963F7D28E17F72")).toBe(true);
    // The new bytes while the old hash is still current (upload, then clientupdate).
    expect(avatarMatches(file, "d41d8cd98f00b204e9800998ecf8427e")).toBe(false);
  });

  it("refuses a flag that is not an MD5: it cannot be checked, and anyone may set it", () => {
    expect(avatarMatches(file, "abc123")).toBe(false);
    expect(isAvatarHash("abc123")).toBe(false);
    expect(isAvatarHash("900150983CD24FB0D6963F7D28E17F72")).toBe(true);
  });
});
