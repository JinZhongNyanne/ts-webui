import { describe, expect, it } from "vitest";
import { lacksWhisperPower, WHISPER_POWER } from "./whisper-power";

describe("lacksWhisperPower", () => {
  it("warns once the server has said this client has no whisper power", () => {
    expect(lacksWhisperPower({ [WHISPER_POWER]: 0 }, true)).toBe(true);
  });

  it.each([
    ["some whisper power", { [WHISPER_POWER]: 25 }],
    ["unlimited whisper power", { [WHISPER_POWER]: -1 }],
  ])("stays quiet with %s", (_what, values) => {
    expect(lacksWhisperPower(values, true)).toBe(false);
  });

  it("stays quiet while the power is unknown: not reported, or nothing loaded yet", () => {
    // Without b_client_permissionoverview_own the hub never learns the power;
    // silence there is not a zero.
    expect(lacksWhisperPower({}, true)).toBe(false);
    expect(lacksWhisperPower({ [WHISPER_POWER]: 0 }, false)).toBe(false);
  });
});
