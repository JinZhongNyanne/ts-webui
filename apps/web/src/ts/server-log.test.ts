import { describe, expect, it } from "vitest";
import {
  filterLog,
  LOG_LEVELS,
  nextLogPage,
  parseLogLine,
  parseLogPage,
  type LogEntry,
} from "./server-log";

// As notifyserverlog delivered them on a live TS3 3.13 server (unescaped by
// the hub), newest first with reverse=1.
const LINE_1 =
  "2026-09-21 21:28:13.473568|INFO    |VirtualServer |1  |client 'probe-93397'(id:4401) was added to servergroup 'Server Admin'(id:6) by client 'probe-sq'(id:1)";
const LINE_2 =
  "2026-09-21 06:13:36.656568|WARNING |VirtualServer |1  |client 'e2e-rig'(id:1) added privilege key for servergroup 'Server Admin'(id:6)";
const LINE_3 = "2026-09-20 10:00:00.000000|ERROR   |FileManager   |1  |a | pipe in the message";

describe("parseLogLine", () => {
  it("splits TeamSpeak's columns and reads the time as UTC", () => {
    expect(parseLogLine(LINE_1)).toEqual({
      at: Date.UTC(2026, 8, 21, 21, 28, 13, 473),
      level: "INFO",
      channel: "VirtualServer",
      message:
        "client 'probe-93397'(id:4401) was added to servergroup 'Server Admin'(id:6) by client 'probe-sq'(id:1)",
      raw: LINE_1,
    });
  });

  it("keeps a pipe inside the message", () => {
    expect(parseLogLine(LINE_3)?.message).toBe("a | pipe in the message");
    expect(parseLogLine(LINE_3)?.level).toBe("ERROR");
  });

  it("keeps a line it cannot split as a message of unknown level", () => {
    expect(parseLogLine("something else")).toEqual({
      at: 0,
      level: "UNKNOWN",
      channel: "",
      message: "something else",
      raw: "something else",
    });
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine("   ")).toBeNull();
  });

  it("reads an unknown level as UNKNOWN rather than trusting it", () => {
    expect(parseLogLine("2026-09-20 10:00:00.0|<b>x</b>|A|1|m")?.level).toBe("UNKNOWN");
  });
});

describe("parseLogPage", () => {
  it("takes the position fields from the first row and one line per row", () => {
    const page = parseLogPage([{ last_pos: "3952", file_size: "4698", l: LINE_1 }, { l: LINE_2 }]);
    expect(page.lastPos).toBe(3952);
    expect(page.fileSize).toBe(4698);
    expect(page.entries.map((e) => e.level)).toEqual(["INFO", "WARNING"]);
  });

  it("is empty for no rows (the hub turns an empty result into none)", () => {
    expect(parseLogPage([])).toEqual({ entries: [], lastPos: 0, fileSize: 0 });
  });

  it("skips empty lines and survives missing positions", () => {
    const page = parseLogPage([{ l: "" }, { l: LINE_1 }]);
    expect(page.entries).toHaveLength(1);
    expect(page.lastPos).toBe(0);
  });
});

describe("nextLogPage", () => {
  it("continues backwards from last_pos until the start of the file", () => {
    expect(nextLogPage({ entries: [], lastPos: 3523, fileSize: 4855 })).toBe(3523);
    expect(nextLogPage({ entries: [], lastPos: 0, fileSize: 4855 })).toBeNull();
  });
});

describe("filterLog", () => {
  const entries = [LINE_1, LINE_2, LINE_3].map((l) => parseLogLine(l)!) as LogEntry[];

  it("keeps the chosen levels", () => {
    expect(filterLog(entries, { levels: new Set(["ERROR"]), query: "" })).toHaveLength(1);
    expect(filterLog(entries, { levels: new Set(LOG_LEVELS), query: "" })).toHaveLength(3);
  });

  it("searches message and channel, case-insensitively, trimmed", () => {
    const all = new Set(LOG_LEVELS);
    expect(filterLog(entries, { levels: all, query: " PRIVILEGE key " })).toEqual([entries[1]]);
    expect(filterLog(entries, { levels: all, query: "filemanager" })).toEqual([entries[2]]);
  });

  it("does not change its input", () => {
    const copy = [...entries];
    filterLog(entries, { levels: new Set(), query: "x" });
    expect(entries).toEqual(copy);
  });
});
