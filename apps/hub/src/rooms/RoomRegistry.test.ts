import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@jinz/protocol";
import { RoomRegistry } from "./RoomRegistry.js";
import type { Session } from "../session/Session.js";

function fakeSession(id: string): { session: Session; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const session = { id, send: (m: ServerMessage) => sent.push(m) } as unknown as Session;
  return { session, sent };
}

describe("RoomRegistry", () => {
  it("broadcasts room state to channel mates and drops leavers", () => {
    const rooms = new RoomRegistry([{ name: "demo", roomState: () => ({ hello: 1 }) }]);
    const a = fakeSession("a");
    const b = fakeSession("b");
    const ref = { serverKey: "ts.example.com:9987", channelId: "5" };
    rooms.join(ref, {
      session: a.session,
      clientId: 1,
      nickname: "A",
      video: false,
      camera: false,
      screen: false,
    });
    rooms.join(ref, {
      session: b.session,
      clientId: 2,
      nickname: "B",
      video: false,
      camera: false,
      screen: false,
    });
    rooms.setPublishing("a", true, false);

    const last = b.sent.at(-1);
    expect(last?.type).toBe("room.state");
    if (last?.type === "room.state") {
      expect(last.state.channelId).toBe("5");
      expect(last.state.video.publishers).toEqual([
        { clientId: 1, nickname: "A", camera: true, screen: false },
      ]);
      expect(last.state.ext).toEqual({ demo: { hello: 1 } });
      // Publishing implies membership of the video room.
      expect(last.state.video.members).toEqual([{ clientId: 1, nickname: "A" }]);
    }

    // A moves to another channel: B's room loses A's publishing flag.
    rooms.join(
      { ...ref, channelId: "6" },
      {
        session: a.session,
        clientId: 1,
        nickname: "A",
        video: false,
        camera: false,
        screen: false,
      },
    );
    const afterMove = b.sent.at(-1);
    if (afterMove?.type === "room.state") expect(afterMove.state.video.publishers).toEqual([]);

    rooms.leave("b");
    expect(rooms.stateOf(ref).video.publishers).toEqual([]);
  });

  it("relays mesh signalling only between video-room mates", () => {
    const rooms = new RoomRegistry();
    const a = fakeSession("a");
    const b = fakeSession("b");
    const c = fakeSession("c");
    const ref = { serverKey: "ts.example.com:9987", channelId: "5" };
    const member = (s: Session, clientId: number) => ({
      session: s,
      clientId,
      nickname: `n${clientId}`,
      video: false,
      camera: false,
      screen: false,
    });
    rooms.join(ref, member(a.session, 1));
    rooms.join(ref, member(b.session, 2));
    rooms.join({ ...ref, channelId: "9" }, member(c.session, 3));

    // Nobody has joined video yet: no peers, no members.
    expect(rooms.peerOf("a", 2)).toBeNull();
    expect(rooms.stateOf(ref).video.members).toEqual([]);

    rooms.setVideo("a", true);
    expect(rooms.peerOf("a", 2)).toBeNull(); // B has not joined
    rooms.setVideo("b", true);
    expect(rooms.peerOf("a", 2)?.session.id).toBe("b");
    expect(rooms.peerOf("b", 1)?.session.id).toBe("a");
    expect(rooms.peerOf("a", 3)).toBeNull(); // other channel
    expect(rooms.peerOf("a", 1)).toBeNull(); // never yourself
    expect(rooms.stateOf(ref).video.members.map((m) => m.clientId)).toEqual([1, 2]);

    // Leaving video also clears publishing flags and drops the member.
    rooms.setPublishing("b", false, true);
    rooms.setVideo("b", false);
    const st = rooms.stateOf(ref);
    expect(st.video.publishers).toEqual([]);
    expect(st.video.members).toEqual([{ clientId: 1, nickname: "n1" }]);
    expect(rooms.peerOf("a", 2)).toBeNull();
  });
});
