import { describe, expect, it } from "vitest";
import { hostMessageAction } from "./hostMessage";

const at = (hostMessageMode: number, hostMessage = "Hi") =>
  hostMessageAction({ hostMessage, hostMessageMode });

describe("hostMessageAction", () => {
  it("does nothing for mode 0 and unknown modes", () => {
    expect(at(0)).toEqual({ kind: "none" });
    expect(at(7)).toEqual({ kind: "none" });
  });

  it("logs for mode 1", () => {
    expect(at(1, " Hi ")).toEqual({ kind: "log", text: "Hi" });
  });

  it("shows a dialog for mode 2", () => {
    expect(at(2)).toEqual({ kind: "modal", text: "Hi", disconnect: false });
  });

  it("shows a dialog and disconnects for mode 3", () => {
    expect(at(3)).toEqual({ kind: "modal", text: "Hi", disconnect: true });
  });

  it("ignores an empty message unless the server wants us gone", () => {
    expect(at(1, "")).toEqual({ kind: "none" });
    expect(at(2, "  ")).toEqual({ kind: "none" });
    expect(at(3, "")).toEqual({ kind: "modal", text: "", disconnect: true });
  });
});
