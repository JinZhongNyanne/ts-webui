import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@jinz/protocol";
import { moderationEvent } from "./moderation-events";

/** Renders "key{params}" so the tests see which message and which values were picked. */
const tr = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}${JSON.stringify(params)}` : key;

const me = { nickname: "me", isSelf: true };
const bob = { nickname: "bob", isSelf: false };

const moved = (reasonId: number, extra: Partial<ServerMessage & { type: "client.moved" }> = {}) =>
  ({ type: "client.moved", clientId: 2, channelId: "1", reasonId, ...extra }) as ServerMessage;

const left = (reasonId: number, extra: Record<string, unknown> = {}) =>
  ({ type: "client.left", clientId: 2, reasonId, reasonMsg: "", ...extra }) as ServerMessage;

describe("moderationEvent", () => {
  it("tells us who kicked us from the channel, and why", () => {
    const ev = moderationEvent(
      moved(4, { invokerId: 9, invokerName: "admin", reasonMsg: "spam" }),
      me,
      tr,
    );
    expect(ev).toEqual({
      kind: "warn",
      text: 'mod.event.kickedFromChannel{"by":"admin","reason":"mod.reason{\\"msg\\":\\"spam\\"}"}',
    });
  });

  it("leaves the reason out when there is none", () => {
    const ev = moderationEvent(moved(4, { invokerName: "admin" }), me, tr);
    expect(ev?.text).toBe('mod.event.kickedFromChannel{"by":"admin","reason":""}');
  });

  it("tells us who moved us", () => {
    const ev = moderationEvent(moved(1, { invokerName: "admin" }), me, tr);
    expect(ev).toEqual({ kind: "info", text: 'mod.event.movedBy{"by":"admin"}' });
  });

  it("reports others being kicked from the channel or the server", () => {
    expect(moderationEvent(moved(4, { invokerName: "admin" }), bob, tr)?.text).toBe(
      'mod.event.clientKickedFromChannel{"name":"bob","by":"admin","reason":""}',
    );
    expect(
      moderationEvent(left(5, { invokerName: "admin", reasonMsg: "bye" }), bob, tr)?.text,
    ).toBe(
      'mod.event.clientKickedFromServer{"name":"bob","by":"admin","reason":"mod.reason{\\"msg\\":\\"bye\\"}"}',
    );
  });

  it("reports others being banned, with who did it and why", () => {
    expect(
      moderationEvent(left(6, { invokerName: "admin", reasonMsg: "cheating" }), bob, tr)?.text,
    ).toBe(
      'mod.event.clientBanned{"name":"bob","by":"admin","reason":"mod.reason{\\"msg\\":\\"cheating\\"}"}',
    );
    expect(moderationEvent(left(6, { invokerName: "admin" }), bob, tr)).toEqual({
      kind: "info",
      text: 'mod.event.clientBanned{"name":"bob","by":"admin","reason":""}',
    });
    // Our own ban arrives as the hub's "banned" error instead.
    expect(moderationEvent(left(6, { invokerName: "admin" }), me, tr)).toBeNull();
  });

  it("stays quiet for ordinary moves and departures, and for clients we never saw", () => {
    expect(moderationEvent(moved(0), me, tr)).toBeNull();
    expect(moderationEvent(moved(1), bob, tr)).toBeNull();
    expect(moderationEvent(left(8), bob, tr)).toBeNull();
    expect(moderationEvent(left(5), undefined, tr)).toBeNull();
    // Our own server kick arrives as the hub's "kicked" error instead.
    expect(moderationEvent(left(5, { invokerName: "admin" }), me, tr)).toBeNull();
  });
});
