import { describe, expect, it } from "vitest";
import { createEncodeQueue, type EncodeSink } from "./encode-queue";
import type { GateRoute } from "./gate";

type Sent = { frame: number; route: GateRoute } | { end: GateRoute };

/** A sink that records what went out; each payload's first byte numbers the frame. */
function recorder(): { sink: EncodeSink; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    sink: {
      frame: (payload, route) => sent.push({ frame: payload[0]!, route }),
      end: (route) => sent.push({ end: route }),
    },
  };
}

const packet = (n: number): Uint8Array => Uint8Array.of(n);

describe("createEncodeQueue", () => {
  it("sends each packet on the route its frame was spoken on", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushFrame("channel");
    q.pushFrame("channel");
    q.encoded(packet(1));
    q.encoded(packet(2));
    expect(sent).toEqual([
      { frame: 1, route: "channel" },
      { frame: 2, route: "channel" },
    ]);
  });

  it("keeps a whisper's tail off the channel across a whisper-to-channel handover", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    // Two whisper frames still in the encoder when the whisper key is let go
    // and channel voice takes over at once.
    q.pushFrame("whisper");
    q.pushFrame("whisper");
    q.pushEnd("whisper");
    q.pushFrame("channel");
    q.pushFrame("channel");
    q.pushEnd("channel");
    q.pushFrame("whisper");
    for (let n = 1; n <= 5; n++) q.encoded(packet(n));
    expect(sent).toEqual([
      { frame: 1, route: "whisper" },
      { frame: 2, route: "whisper" },
      { end: "whisper" },
      { frame: 3, route: "channel" },
      { frame: 4, route: "channel" },
      { end: "channel" },
      { frame: 5, route: "whisper" },
    ]);
  });

  it("sends an end marker only after the last frame before it is out", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushFrame("channel");
    q.pushFrame("channel");
    q.pushEnd("channel");
    expect(sent).toEqual([]);
    q.encoded(packet(1));
    expect(sent).toEqual([{ frame: 1, route: "channel" }]);
    q.encoded(packet(2));
    expect(sent).toEqual([
      { frame: 1, route: "channel" },
      { frame: 2, route: "channel" },
      { end: "channel" },
    ]);
  });

  it("sends an end marker at once when no frame is waiting", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushEnd("whisper");
    expect(sent).toEqual([{ end: "whisper" }]);
    expect(q.pending).toBe(0);
  });

  it("drops a packet whose route is unknown rather than guess the channel", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.encoded(packet(1));
    expect(sent).toEqual([]);
  });

  it("sends the end markers still owed when the encoder closes, and loses its frames", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushFrame("whisper");
    q.pushEnd("whisper");
    q.pushFrame("channel");
    q.pushEnd("channel");
    q.pushFrame("channel");
    q.close();
    expect(sent).toEqual([{ end: "whisper" }, { end: "channel" }]);
    expect(q.pending).toBe(0);
    // A straggler from the closed encoder has nowhere to go.
    q.encoded(packet(9));
    expect(sent).toHaveLength(2);
  });

  it("does not shift later frames onto the wrong route when an encode is refused", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushFrame("whisper");
    q.pushFrame("whisper");
    q.dropLastFrame(); // the encoder refused it: no packet will follow
    q.pushEnd("whisper");
    q.pushFrame("channel");
    q.encoded(packet(1));
    q.encoded(packet(2));
    expect(sent).toEqual([
      { frame: 1, route: "whisper" },
      { end: "whisper" },
      { frame: 2, route: "channel" },
    ]);
  });

  it("never drops an owed end marker when asked to drop a frame", () => {
    const { sink, sent } = recorder();
    const q = createEncodeQueue(sink);
    q.pushFrame("whisper");
    q.pushEnd("whisper");
    q.dropLastFrame();
    expect(q.pending).toBe(2);
    q.encoded(packet(1));
    expect(sent).toEqual([{ frame: 1, route: "whisper" }, { end: "whisper" }]);
  });
});
