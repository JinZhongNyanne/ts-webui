/**
 * Where each encoded voice packet goes, and when each end-of-talk marker
 * does.
 *
 * WebCodecs encodes asynchronously, so by the time a frame comes out of the
 * encoder the transmission it belonged to may have ended or switched between
 * channel voice and a whisper. Each frame must still go where it was spoken,
 * or the tail of a whisper would reach the whole channel; and the end marker
 * must follow its transmission's last frame rather than overtake it, or the
 * far side would hear a stray frame after "stopped talking". The encoder
 * turns each 20 ms frame into exactly one packet, in order, so a queue of
 * the routes handed in, with the end markers owed between them, is enough.
 *
 * One queue per encoder: a rebuilt encoder starts with an empty one. Pure
 * apart from the sink, so the rules are tested without an AudioContext.
 */
import type { GateRoute } from "./gate";

/** Where the queue's decisions are carried out (the hub connection, in the engine). */
export interface EncodeSink {
  /** An encoded frame, to be sent on the route it was spoken on. */
  frame(payload: Uint8Array, route: GateRoute): void;
  /** The end-of-talk marker for a transmission on `route`. */
  end(route: GateRoute): void;
}

export interface EncodeQueue {
  /** A frame spoken on `route` was handed to the encoder; its packet will follow. */
  pushFrame(route: GateRoute): void;
  /**
   * The frame just pushed was refused by the encoder, so no packet will
   * follow for it; left queued it would push every later packet onto the
   * route of the frame before it.
   */
  dropLastFrame(): void;
  /** The transmission on `route` ended: the marker goes once the frames before it are out. */
  pushEnd(route: GateRoute): void;
  /** The encoder's next packet, which belongs to the oldest frame still queued. */
  encoded(payload: Uint8Array): void;
  /**
   * The encoder closed and its pending frames are lost with it. The end
   * markers queued behind them are still owed, or the far side would keep
   * showing us as talking.
   */
  close(): void;
  /** Frames and end markers still waiting. */
  readonly pending: number;
}

/** A frame in the encoder, or the end-of-talk marker owed once the frames before it are out. */
interface EncodeSlot {
  readonly route: GateRoute;
  readonly end: boolean;
}

export function createEncodeQueue(sink: EncodeSink): EncodeQueue {
  let slots: readonly EncodeSlot[] = [];

  /** Sends every end marker at the head of the queue, now that nothing is in front of it. */
  function releaseEnds(): void {
    let head = 0;
    while (slots[head]?.end) head++;
    const released = slots.slice(0, head);
    slots = slots.slice(head);
    for (const slot of released) sink.end(slot.route);
  }

  return {
    pushFrame(route) {
      slots = [...slots, { route, end: false }];
    },
    dropLastFrame() {
      // Only a frame can be refused; an end marker behind it is still owed.
      if (slots.length > 0 && !slots[slots.length - 1]!.end) slots = slots.slice(0, -1);
    },
    pushEnd(route) {
      if (slots.length === 0) sink.end(route);
      else slots = [...slots, { route, end: true }];
    },
    encoded(payload) {
      const [slot, ...rest] = slots;
      slots = rest;
      // Nothing queued means the frame's route is unknown: drop it rather
      // than guess, since guessing "channel" could leak a whisper.
      if (slot && !slot.end) sink.frame(payload, slot.route);
      releaseEnds();
    },
    close() {
      const owed = slots.filter((slot) => slot.end);
      slots = [];
      for (const slot of owed) sink.end(slot.route);
    },
    get pending() {
      return slots.length;
    },
  };
}
