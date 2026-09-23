import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_DEFAULT_LIMIT,
  ENCODE_ATTEMPTS,
  avatarByteLimit,
  avatarHash,
  encodeWithinLimit,
  removeAvatar,
  uploadAvatar,
  type AvatarIo,
} from "./avatar-file";

const UID = "rto1GjL3NJJZuUcHrfrMEs2lszg=";

describe("avatarHash", () => {
  it("is the file's MD5 in lowercase hex, as native clients set client_flag_avatar", () => {
    expect(avatarHash(new TextEncoder().encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(avatarHash(new Uint8Array())).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});

describe("avatarByteLimit", () => {
  it("follows i_client_max_avatar_filesize, capped by the hub", () => {
    expect(avatarByteLimit(50_000, 1_000_000)).toBe(50_000);
    expect(avatarByteLimit(500_000, 100_000)).toBe(100_000);
  });

  it("is null when the server allows no avatar", () => {
    expect(avatarByteLimit(0, 1_000_000)).toBeNull();
  });

  it("falls back to TeamSpeak's default when unknown or unlimited", () => {
    expect(avatarByteLimit(undefined, 1_000_000)).toBe(AVATAR_DEFAULT_LIMIT);
    expect(avatarByteLimit(-1, undefined)).toBe(AVATAR_DEFAULT_LIMIT);
  });
});

describe("encodeWithinLimit", () => {
  const blob = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

  it("keeps PNG when it fits", async () => {
    const encode = vi.fn(async (type: string) => blob(100, type));
    const out = await encodeWithinLimit(encode, 1000);
    expect(out?.type).toBe("image/png");
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("falls back to JPEG at falling quality until it fits", async () => {
    const sizes: Record<string, number> = { png: 5000, "0.92": 3000, "0.85": 1500, "0.75": 900 };
    const encode = vi.fn(async (type: string, q?: number) =>
      blob(sizes[q === undefined ? "png" : String(q)] ?? 10, type),
    );
    const out = await encodeWithinLimit(encode, 1000);
    expect(out?.type).toBe("image/jpeg");
    expect(out?.size).toBe(900);
    expect(encode.mock.calls.map((c) => c[1])).toEqual([undefined, 0.92, 0.85, 0.75]);
  });

  it("gives up (null) when nothing fits or the encoder fails", async () => {
    expect(await encodeWithinLimit(async (t) => blob(5000, t), 1000)).toBeNull();
    expect(await encodeWithinLimit(async () => null, 1000)).toBeNull();
    expect(ENCODE_ATTEMPTS.length).toBeGreaterThan(2);
  });
});

describe("avatar actions", () => {
  function io() {
    const calls: unknown[] = [];
    const fake: AvatarIo = {
      upload: vi.fn(async (file: File) => void calls.push(["upload", file.name, file.size])),
      command: vi.fn(async (cmd, args) => {
        calls.push([cmd, args]);
        return [];
      }),
    };
    return { fake, calls };
  }

  it("uploads to the owner's avatar file, then announces its MD5", async () => {
    const { fake, calls } = io();
    const bytes = new TextEncoder().encode("abc");
    await uploadAvatar(bytes, "image/png", UID, fake);
    expect(calls).toEqual([
      ["upload", "avatar_konkdfbkdcphdejcfjljehahknpkmmbcmnkflddi", 3],
      ["clientupdate", { client_flag_avatar: "900150983cd24fb0d6963f7d28e17f72" }],
    ]);
  });

  it("does not announce an avatar whose upload failed", async () => {
    const { fake, calls } = io();
    fake.upload = async () => {
      throw new Error("refused");
    };
    await expect(uploadAvatar(new Uint8Array(3), "image/png", UID, fake)).rejects.toThrow(
      "refused",
    );
    expect(calls).toEqual([]);
  });

  it("refuses without a UID to name the file after", async () => {
    const { fake } = io();
    await expect(uploadAvatar(new Uint8Array(3), "image/png", "", fake)).rejects.toThrow();
  });

  it("clears the flag, then deletes the file only where permitted (and quietly)", async () => {
    const { fake, calls } = io();
    await removeAvatar(fake, false);
    expect(calls).toEqual([["clientupdate", { client_flag_avatar: "" }]]);

    const second = io();
    second.fake.command = vi.fn(async (cmd, args) => {
      second.calls.push([cmd, args]);
      if (cmd === "ftdeleteavatar") throw Object.assign(new Error("no"), { code: "2568" });
      return [];
    });
    await removeAvatar(second.fake, true);
    expect(second.calls).toEqual([
      ["clientupdate", { client_flag_avatar: "" }],
      ["ftdeleteavatar", {}],
    ]);
  });

  it("passes on any other delete failure", async () => {
    const { fake } = io();
    fake.command = vi.fn(async (cmd) => {
      if (cmd === "ftdeleteavatar") throw Object.assign(new Error("timeout"), { code: "timeout" });
      return [];
    });
    await expect(removeAvatar(fake, true)).rejects.toThrow("timeout");
  });
});
