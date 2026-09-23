import { describe, expect, it } from "vitest";
import {
  INTERNAL_AVATAR_MAX_BYTES,
  INTERNAL_ICON_MAX_BYTES,
  internalUploadLimit,
} from "./internal-limits.js";

describe("internalUploadLimit", () => {
  it("caps icons, whatever the server allows", () => {
    expect(internalUploadLimit("/icon_3421780262", undefined)).toBe(INTERNAL_ICON_MAX_BYTES);
    expect(internalUploadLimit("/icon_3421780262", 50_000_000)).toBe(INTERNAL_ICON_MAX_BYTES);
  });

  it("caps avatars, tighter when i_client_max_avatar_filesize says so", () => {
    const avatar = "/avatar_aaab";
    expect(internalUploadLimit(avatar, undefined)).toBe(INTERNAL_AVATAR_MAX_BYTES);
    expect(internalUploadLimit(avatar, -1)).toBe(INTERNAL_AVATAR_MAX_BYTES);
    expect(internalUploadLimit(avatar, 200_000)).toBe(200_000);
    expect(internalUploadLimit(avatar, 50_000_000)).toBe(INTERNAL_AVATAR_MAX_BYTES);
    // 0 is left to the server to refuse, with its own message.
    expect(internalUploadLimit(avatar, 0)).toBe(INTERNAL_AVATAR_MAX_BYTES);
  });

  it("keeps the caps in the sizes the hub buffers and caches", () => {
    expect(INTERNAL_ICON_MAX_BYTES).toBe(64 * 1024);
    expect(INTERNAL_AVATAR_MAX_BYTES).toBe(1024 * 1024);
  });
});
