import { beforeEach, describe, expect, it, vi } from "vitest";

const tsCommand = vi.fn();
vi.mock("../ts/commands", () => ({ tsCommand: (...a: unknown[]) => tsCommand(...a) }));

const { createFolder, deleteEntries, renameEntry } = await import("./manage");

beforeEach(() => {
  tsCommand.mockReset();
  tsCommand.mockResolvedValue([]);
});

describe("file management actions", () => {
  it("creates a folder by its whole path", async () => {
    await createFolder("5", "/docs", "new", "pw");
    expect(tsCommand).toHaveBeenCalledWith("ftcreatedir", {
      cid: "5",
      dirname: "/docs/new",
      cpw: "pw",
    });
  });

  it("renames within the folder, without a password field when there is none", async () => {
    await renameEntry("5", "/", "a.txt", "b.txt", "");
    expect(tsCommand).toHaveBeenCalledWith("ftrenamefile", {
      cid: "5",
      oldname: "/a.txt",
      newname: "/b.txt",
    });
  });

  it("refuses a name that is not a path segment before sending anything", async () => {
    await expect(createFolder("5", "/", "a/b")).rejects.toThrow();
    await expect(renameEntry("5", "/", "a", "..")).rejects.toThrow();
    expect(tsCommand).not.toHaveBeenCalled();
  });

  it("deletes several entries in one command", async () => {
    await deleteEntries("5", "/d", ["x", "y"]);
    expect(tsCommand).toHaveBeenCalledTimes(1);
    expect(tsCommand).toHaveBeenCalledWith("ftdeletefile", { cid: "5", names: ["/d/x", "/d/y"] });
  });

  it("splits a very long delete into commands of at most 100 paths", async () => {
    const names = Array.from({ length: 250 }, (_, i) => `f${i}`);
    await deleteEntries("5", "/", names);
    expect(tsCommand.mock.calls.map((c) => (c[1] as { names: string[] }).names.length)).toEqual([
      100, 100, 50,
    ]);
  });
});
