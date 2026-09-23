import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { ServerError } from "@honeybbq/teamspeak-client";
import { FT_HUB_CODES } from "@jinz/protocol";
import { TsCommandFailure } from "../gateway/commands.js";
import { GuardBusyError } from "../gateway/server-guard.js";
import { parsePermissionList } from "../gateway/perms.js";
import { contentDisposition } from "./disposition.js";
import { ExactLength, TransferLengthError } from "./exact-length.js";
import { FtRefused, ftErrorReply } from "./errors.js";
import { FtInitTimeout } from "./ft-waiters.js";
import { contentLengthOf, decodeChannelPassword, uploadLimit } from "./limits.js";

describe("contentDisposition", () => {
  it("is always an attachment with an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(contentDisposition("截图 1.png")).toBe(
      `attachment; filename="__ 1.png"; filename*=UTF-8''%E6%88%AA%E5%9B%BE%201.png`,
    );
  });

  it("cannot be broken out of: quotes, backslashes, separators and controls", () => {
    const header = contentDisposition('a";\r\nx-evil: 1\\b.html');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith(`attachment; filename="a_;__x-evil: 1_b.html"; `)).toBe(true);
    expect(header).toContain(`filename*=UTF-8''a%22%3B`);
    // RFC 5987 attr-chars only in the extended value.
    const ext = header.slice(header.indexOf("''") + 2);
    expect(ext).toMatch(/^[A-Za-z0-9!#$&+.^_`|~%-]+$/);
  });

  it("falls back to a name for an empty one", () => {
    expect(contentDisposition("")).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    );
  });
});

describe("ExactLength", () => {
  const run = (chunks: string[], expected: number) =>
    pipeline(
      Readable.from(chunks.map((c) => Buffer.from(c))),
      new ExactLength(expected),
      async (s) => {
        for await (const _ of s) void _;
      },
    );

  it("passes exactly the expected bytes", async () => {
    await expect(run(["ab", "cd"], 4)).resolves.toBeUndefined();
    await expect(run([], 0)).resolves.toBeUndefined();
  });

  it("fails a short stream at its end", async () => {
    const err = await run(["ab"], 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransferLengthError);
    expect(err).toMatchObject({ expected: 4, received: 2 });
  });

  it("fails a long stream as soon as it overflows", async () => {
    await expect(run(["abc", "de"], 4)).rejects.toBeInstanceOf(TransferLengthError);
  });
});

describe("ftErrorReply", () => {
  const catalog = parsePermissionList([
    { permid: "236", permname: "i_ft_needed_file_upload_power" },
  ]);

  it("names the permission a refusal was about", () => {
    const r = ftErrorReply(new TsCommandFailure("2568", "insufficient", 236), catalog);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      error: "2568",
      message: 'tsErr.missingPermission\x01{"perm":"i_ft_needed_file_upload_power"}',
      failedPermission: "i_ft_needed_file_upload_power",
    });
  });

  it("maps TeamSpeak file errors to statuses", () => {
    const status = (id: string) => ftErrorReply(new TsCommandFailure(id, "x", null)).status;
    expect(status("781")).toBe(403);
    expect(status("2051")).toBe(404);
    expect(status("768")).toBe(404);
    expect(status("2050")).toBe(409);
    expect(status("2058")).toBe(409);
    expect(status("2069")).toBe(403);
    expect(status("3331")).toBe(429);
    expect(status("2059")).toBe(502);
    expect(ftErrorReply(new ServerError("781", "x")).body.message).toBe("tsErr.channelPassword");
  });

  it("covers the hub's own refusals", () => {
    const refused = ftErrorReply(new FtRefused(413, FT_HUB_CODES.tooLarge, "ft.tooLarge"));
    expect(refused).toEqual({
      status: 413,
      body: { error: FT_HUB_CODES.tooLarge, message: "ft.tooLarge" },
    });
    expect(ftErrorReply(new GuardBusyError()).status).toBe(429);
    expect(ftErrorReply(new FtInitTimeout())).toEqual({
      status: 504,
      body: { error: "timeout", message: "tsErr.timeout" },
    });
  });

  it("says nothing about unexpected errors", () => {
    expect(ftErrorReply(new Error("ECONNREFUSED 10.0.0.1:30033"))).toEqual({
      status: 502,
      body: { error: FT_HUB_CODES.failed, message: "ft.failed" },
    });
  });
});

describe("upload limits", () => {
  const MB = 1024 * 1024;

  it("is the hub's limit unless the quota is smaller", () => {
    expect(uploadLimit(100 * MB, undefined)).toBe(100 * MB);
    expect(uploadLimit(100 * MB, -1)).toBe(100 * MB);
    expect(uploadLimit(100 * MB, 10)).toBe(10 * MB);
    expect(uploadLimit(100 * MB, 500)).toBe(100 * MB);
    expect(uploadLimit(100 * MB, 0)).toBe(0);
  });

  it("wants a plain Content-Length", () => {
    expect(contentLengthOf({ "content-length": "12" })).toBe(12);
    expect(contentLengthOf({ "content-length": "0" })).toBe(0);
    expect(contentLengthOf({})).toBeNull();
    expect(contentLengthOf({ "content-length": "-1" })).toBeNull();
    expect(contentLengthOf({ "content-length": "1e3" })).toBeNull();
    expect(contentLengthOf({ "content-length": "12", "transfer-encoding": "chunked" })).toBeNull();
  });

  it("decodes the channel password header", () => {
    expect(decodeChannelPassword(undefined)).toBe("");
    expect(decodeChannelPassword("s%C3%A9cret%20pw")).toBe("sécret pw");
    expect(decodeChannelPassword("%E0%A4%A")).toBeNull();
    expect(decodeChannelPassword(["a", "b"])).toBeNull();
    expect(decodeChannelPassword("x".repeat(129))).toBeNull();
  });
});
