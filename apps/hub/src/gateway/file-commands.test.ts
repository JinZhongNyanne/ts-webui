import { describe, expect, it } from "vitest";
import { ServerError } from "@honeybbq/teamspeak-client";
import { TsCmdRequestSchema, type TsCmdRequest } from "@jinz/protocol";
import { describeTsFailure, prepareTsCommand } from "./commands.js";

function req(cmd: string, args: unknown): TsCmdRequest {
  return TsCmdRequestSchema.parse({ type: "ts.cmd", id: "r1", cmd, args });
}

const prepared = (cmd: string, args: unknown) => prepareTsCommand(req(cmd, args));

describe("file command builders (M3)", () => {
  it("ftgetfilelist hashes the channel password, as a live server wants it", () => {
    // Sent in clear, a live TS3 3.13 server answered 781 (wrong password).
    expect(prepared("ftgetfilelist", { cid: "5", path: "/sub dir", cpw: "secret" })).toEqual({
      text: "ftgetfilelist cid=5 cpw=5en6G6MezRroT3XKqkdPOmY\\/BfQ= path=\\/sub\\sdir",
      collect: "notifyfilelist",
    });
  });

  it("sends an empty cpw when there is no password (the server wants the field)", () => {
    expect(prepared("ftgetfilelist", { cid: "1", path: "/" }).text).toBe(
      "ftgetfilelist cid=1 cpw= path=\\/",
    );
  });

  it("ftgetfileinfo collects notifyfileinfo", () => {
    expect(prepared("ftgetfileinfo", { cid: "5", name: "/a b.txt" })).toEqual({
      text: "ftgetfileinfo cid=5 cpw= name=\\/a\\sb.txt",
      collect: "notifyfileinfo",
    });
  });
});

describe("file management builders (M3 file browser)", () => {
  it("ftcreatedir hashes the password and escapes the path", () => {
    expect(prepared("ftcreatedir", { cid: "5", dirname: "/new dir", cpw: "secret" })).toEqual({
      text: "ftcreatedir cid=5 cpw=5en6G6MezRroT3XKqkdPOmY\\/BfQ= dirname=\\/new\\sdir",
      collect: null,
    });
  });

  it("ftrenamefile within a channel sends no target pair", () => {
    expect(prepared("ftrenamefile", { cid: "5", oldname: "/a.txt", newname: "/b c.txt" })).toEqual({
      text: "ftrenamefile cid=5 cpw= oldname=\\/a.txt newname=\\/b\\sc.txt",
      collect: null,
    });
  });

  it("ftrenamefile to another channel hashes both passwords", () => {
    expect(
      prepared("ftrenamefile", {
        cid: "5",
        cpw: "secret",
        tcid: "6",
        oldname: "/a",
        newname: "/a",
      }).text,
    ).toBe(
      "ftrenamefile cid=5 cpw=5en6G6MezRroT3XKqkdPOmY\\/BfQ= tcid=6 tcpw= oldname=\\/a newname=\\/a",
    );
  });

  it("ftdeletefile sends one row per path", () => {
    expect(prepared("ftdeletefile", { cid: "5", names: ["/a b", "/dir"] })).toEqual({
      text: "ftdeletefile cid=5 cpw= name=\\/a\\sb|name=\\/dir",
      collect: null,
    });
  });

  it("a path cannot smuggle in another row or parameter", () => {
    const text = prepared("ftdeletefile", { cid: "5", names: ["/a|name=/b c=d"] }).text;
    expect(text).toBe("ftdeletefile cid=5 cpw= name=\\/a\\pname=\\/b\\sc=d");
  });
});

describe("file transfer errors", () => {
  it("have their own messages", () => {
    const cases: Array<[string, string]> = [
      ["2050", "tsErr.fileExists"],
      ["2051", "tsErr.fileNotFound"],
      // ftgetfileinfo on a missing file answers 2052 on a live server.
      ["2052", "tsErr.fileIo"],
      ["2054", "tsErr.fileInvalidPath"],
      ["2058", "tsErr.fileInUse"],
      ["2068", "tsErr.ftServerQuota"],
      ["2069", "tsErr.ftClientQuota"],
    ];
    for (const [id, key] of cases) {
      expect(describeTsFailure("x", new ServerError(id, "whatever")).message).toBe(key);
    }
  });
});
