import { describe, expect, it } from "vitest";
import type { FtEntry } from "@jinz/protocol";
import {
  breadcrumbs,
  folderNameProblem,
  nextSort,
  planUploads,
  renameProblem,
  sortEntries,
} from "./browser";

const file = (name: string, size = 0, datetime = 0): FtEntry => ({
  name,
  size,
  datetime,
  isDir: false,
});
const dir = (name: string, datetime = 0): FtEntry => ({ name, size: 0, datetime, isDir: true });
const names = (entries: readonly FtEntry[]) => entries.map((e) => e.name);

describe("sortEntries", () => {
  const entries = [
    file("b.txt", 30, 300),
    dir("Zeta", 100),
    file("A.txt", 10, 200),
    dir("alpha", 400),
    file("c.txt", 20, 100),
  ];

  it("puts folders first, then sorts by name ignoring case", () =>
    expect(names(sortEntries(entries, { key: "name", dir: "asc" }))).toEqual([
      "alpha",
      "Zeta",
      "A.txt",
      "b.txt",
      "c.txt",
    ]));

  it("keeps folders first when the order is reversed", () =>
    expect(names(sortEntries(entries, { key: "name", dir: "desc" }))).toEqual([
      "Zeta",
      "alpha",
      "c.txt",
      "b.txt",
      "A.txt",
    ]));

  it("sorts by size, folders by name among themselves", () =>
    expect(names(sortEntries(entries, { key: "size", dir: "desc" }))).toEqual([
      "alpha",
      "Zeta",
      "b.txt",
      "c.txt",
      "A.txt",
    ]));

  it("sorts by date", () =>
    expect(names(sortEntries(entries, { key: "datetime", dir: "asc" }))).toEqual([
      "Zeta",
      "alpha",
      "c.txt",
      "A.txt",
      "b.txt",
    ]));

  it("breaks ties by name and sorts numbers naturally", () =>
    expect(
      names(
        sortEntries([file("f10", 1), file("f2", 1), file("f1", 1)], { key: "size", dir: "asc" }),
      ),
    ).toEqual(["f1", "f2", "f10"]));

  it("does not change the list it was given", () => {
    const copy = [...entries];
    sortEntries(entries, { key: "size", dir: "asc" });
    expect(entries).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("flips the direction of the current column", () =>
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" }));
  it("starts names ascending and sizes and dates newest / largest first", () => {
    expect(nextSort({ key: "size", dir: "asc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "size")).toEqual({ key: "size", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "datetime")).toEqual({
      key: "datetime",
      dir: "desc",
    });
  });
});

describe("breadcrumbs", () => {
  it("is just the root at the root", () =>
    expect(breadcrumbs("/")).toEqual([{ name: "", path: "/" }]));
  it("has one crumb per folder, each with its own path", () =>
    expect(breadcrumbs("/a b/c")).toEqual([
      { name: "", path: "/" },
      { name: "a b", path: "/a b" },
      { name: "c", path: "/a b/c" },
    ]));
  it("falls back to the root for a path that is not valid", () =>
    expect(breadcrumbs("/a/../b")).toEqual([{ name: "", path: "/" }]));
});

describe("planUploads", () => {
  const listing = [file("a.txt"), dir("docs"), file("b.txt")];

  it("marks names that exist as files, and as folders", () =>
    expect(
      planUploads(listing, [{ name: "a.txt" }, { name: "new.txt" }, { name: "docs" }]),
    ).toEqual([
      { index: 0, name: "a.txt", conflict: "file" },
      { index: 1, name: "new.txt", conflict: null },
      { index: 2, name: "docs", conflict: "folder" },
    ]));

  it("checks the name the file will be stored under", () =>
    expect(planUploads([file("a_b.txt")], [{ name: "a/b.txt" }])).toEqual([
      { index: 0, name: "a_b.txt", conflict: "file" },
    ]));

  it("flags a name that cannot be stored", () =>
    expect(planUploads(listing, [{ name: ".." }])).toEqual([
      { index: 0, name: "..", conflict: "invalid" },
    ]));

  it("treats a second file of the same name in one drop as a conflict with the first", () =>
    expect(planUploads([], [{ name: "x" }, { name: "x" }])).toEqual([
      { index: 0, name: "x", conflict: null },
      { index: 1, name: "x", conflict: "duplicate" },
    ]));
});

describe("renameProblem", () => {
  const listing = [file("a.txt"), dir("docs")];
  it("accepts a free name", () => expect(renameProblem(listing, "a.txt", "b.txt")).toBeNull());
  it("refuses an unchanged or blank name", () => {
    expect(renameProblem(listing, "a.txt", "a.txt")).toBe("unchanged");
    expect(renameProblem(listing, "a.txt", "  ")).toBe("invalid");
  });
  it("refuses separators and dot names", () => {
    expect(renameProblem(listing, "a.txt", "x/y")).toBe("invalid");
    expect(renameProblem(listing, "a.txt", "..")).toBe("invalid");
  });
  // The server would replace the other file without asking.
  it("refuses a name that is taken", () => {
    expect(renameProblem(listing, "a.txt", "docs")).toBe("exists");
    expect(renameProblem(listing, "docs", "a.txt")).toBe("exists");
  });
});

describe("folderNameProblem", () => {
  it("accepts a new name, refuses taken and invalid ones", () => {
    expect(folderNameProblem([file("a")], "b")).toBeNull();
    expect(folderNameProblem([file("a")], "a")).toBe("exists");
    expect(folderNameProblem([], "")).toBe("invalid");
    expect(folderNameProblem([], "a\\b")).toBe("invalid");
  });
});
