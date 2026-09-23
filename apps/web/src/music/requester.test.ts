import { describe, expect, it } from "vitest";
import { shownRequester } from "./requester";

describe("shownRequester", () => {
  it("shows whatever name the song carries, the bot's guest name included", () => {
    expect(shownRequester("Alice")).toBe("Alice");
    expect(shownRequester(" 游客 ")).toBe("游客");
  });

  it("shows nothing for a song without a name", () => {
    expect(shownRequester(undefined)).toBeNull();
    expect(shownRequester("  ")).toBeNull();
  });
});
