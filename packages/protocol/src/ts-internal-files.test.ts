import { describe, expect, it } from "vitest";
import {
  AVATAR_MD5,
  ICON_DIR,
  avatarDeleteName,
  avatarFilePath,
  crc32,
  iconFilePath,
  iconIdFromFileName,
  iconIdOf,
  iconPermValue,
  isBuiltinIconId,
  isIconFilePath,
  isInternalChannelId,
  isInternalUploadPath,
  uidToAvatarName,
} from "./ts-internal-files.js";
import { DECIMAL_ID } from "./ids.js";

const bytes = (s: string) => new TextEncoder().encode(s);
/** Seen on a live TS3 3.13 server: this UID's avatar was stored under this name. */
const LIVE_UID = "rto1GjL3NJJZuUcHrfrMEs2lszg=";
const LIVE_NAME = "konkdfbkdcphdejcfjljehahknpkmmbcmnkflddi";

describe("avatar file names", () => {
  it("writes the UID's bytes as a–p hex, as the server names the file", () => {
    expect(uidToAvatarName(LIVE_UID)).toBe(LIVE_NAME);
    expect(avatarFilePath(LIVE_UID)).toBe(`/avatar_${LIVE_NAME}`);
  });

  it("decodes base64 without padding and refuses what is not base64", () => {
    expect(uidToAvatarName(LIVE_UID.replace(/=$/, ""))).toBe(LIVE_NAME);
    expect(uidToAvatarName("")).toBe("");
    expect(uidToAvatarName("not base64!")).toBe("");
    expect(avatarFilePath("")).toBeNull();
    expect(avatarFilePath("serveradmin?")).toBeNull();
  });

  it("names the file by its base64 UID for ftdeletefile (the server converts it)", () => {
    expect(avatarDeleteName(LIVE_UID)).toBe(`/avatar_${LIVE_UID}`);
    expect(avatarDeleteName("")).toBeNull();
    expect(avatarDeleteName("not base64!")).toBeNull();
    // UIDs are base64, "/" included; the server takes the name as it is.
    expect(avatarDeleteName("ab/c+d=")).toBe("/avatar_ab/c+d=");
  });

  it("takes an md5 hex digest as the avatar flag, or empty to clear it", () => {
    expect(AVATAR_MD5.test("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(AVATAR_MD5.test("")).toBe(true);
    expect(AVATAR_MD5.test("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(AVATAR_MD5.test("abc")).toBe(false);
  });
});

describe("icons", () => {
  it("computes CRC-32 (IEEE) like zlib, unsigned", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("names an icon by the CRC-32 of its bytes", () => {
    expect(iconIdOf(bytes("123456789"))).toBe(3421780262);
    expect(iconFilePath(3421780262)).toBe("/icon_3421780262");
    // A signed id (as permissions carry it) names the same file.
    expect(iconFilePath(-873187034)).toBe("/icon_3421780262");
    expect(ICON_DIR).toBe("/icons");
  });

  it("sends ids above int32 as the negative int32 permissions store", () => {
    expect(iconPermValue(3421780262)).toBe(-873187034);
    expect(iconPermValue(1472049519)).toBe(1472049519);
    expect(iconPermValue(-873187034)).toBe(-873187034);
  });

  it("reads icon ids back from a listing, and nothing else", () => {
    expect(iconIdFromFileName("icon_3421780262")).toBe(3421780262);
    expect(iconIdFromFileName("icon_0")).toBeNull();
    expect(iconIdFromFileName("icon_4294967296")).toBeNull();
    expect(iconIdFromFileName("icon_12a")).toBeNull();
    expect(iconIdFromFileName("icon_-5")).toBeNull();
    expect(iconIdFromFileName("avatar_abc")).toBeNull();
  });

  it("knows the built-in group icons are not files", () => {
    expect(isBuiltinIconId(100)).toBe(true);
    expect(isBuiltinIconId(999)).toBe(true);
    expect(isBuiltinIconId(1000)).toBe(false);
    expect(isBuiltinIconId(0)).toBe(false);
  });
});

describe("isInternalUploadPath", () => {
  it("allows only the caller's own avatar and icon files in channel 0", () => {
    expect(isInternalUploadPath(`/avatar_${LIVE_NAME}`, LIVE_UID)).toBe(true);
    expect(isInternalUploadPath("/icon_3421780262", LIVE_UID)).toBe(true);
    expect(isInternalUploadPath(`/avatar_${"a".repeat(40)}`, LIVE_UID)).toBe(false);
    expect(isInternalUploadPath(`/avatar_${LIVE_NAME}`, "")).toBe(false);
    expect(isInternalUploadPath("/icon_42", LIVE_UID)).toBe(false);
    expect(isInternalUploadPath("/icon_4294967296", LIVE_UID)).toBe(false);
    expect(isInternalUploadPath("/icons/icon_3421780262", LIVE_UID)).toBe(false);
    expect(isInternalUploadPath("/whatever.txt", LIVE_UID)).toBe(false);
    // Another file than /icon_3421780262, and another cache key.
    expect(isInternalUploadPath("/icon_03421780262", LIVE_UID)).toBe(false);
  });

  it("knows icon files and channel 0 in their canonical spelling", () => {
    expect(isIconFilePath("/icon_5000")).toBe(true);
    expect(isIconFilePath("/icon_05000")).toBe(false);
    expect(isIconFilePath("/icon_500")).toBe(false);
    expect(isInternalChannelId("0")).toBe(true);
    expect(isInternalChannelId("00")).toBe(true);
    expect(isInternalChannelId("10")).toBe(false);
  });
});

describe("DECIMAL_ID", () => {
  it("takes canonical ids only (TS reads 00 as 0)", () => {
    expect(DECIMAL_ID.test("0")).toBe(true);
    expect(DECIMAL_ID.test("7")).toBe(true);
    expect(DECIMAL_ID.test("18446744073709551615")).toBe(true);
    expect(DECIMAL_ID.test("00")).toBe(false);
    expect(DECIMAL_ID.test("007")).toBe(false);
    expect(DECIMAL_ID.test("")).toBe(false);
  });
});
