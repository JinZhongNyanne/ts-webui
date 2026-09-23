/**
 * The sound-pack event list: the subset of TeamSpeak 3's default sound pack
 * (sound/default/settings.ini) that this client can actually detect from what
 * the hub streams to it. File transfer and recording events are left out
 * because the web client has no such features yet.
 *
 * Every event has a sound switch and a desktop-notification switch. Events we
 * cause ourselves (mute, away) never raise a desktop notification — the user is
 * looking at the button they just pressed — so they are marked not notifiable.
 */

export const CUE_EVENTS = [
  "connected",
  "disconnected",
  "connectionLost",
  "kickedFromServer",
  "banned",
  "channelUserJoined",
  "channelUserLeft",
  "serverUserJoined",
  "serverUserLeft",
  "whisperReceived",
  "movedByOther",
  "kickedFromChannel",
  "poked",
  "privateMessage",
  "channelMessage",
  "serverMessage",
  "micMuted",
  "micUnmuted",
  "speakersMuted",
  "speakersUnmuted",
  "awayOn",
  "awayOff",
  "talkPowerGranted",
  "talkPowerRevoked",
] as const;

export type CueEvent = (typeof CUE_EVENTS)[number];

export interface CueEventSettings {
  sound: boolean;
  notify: boolean;
}

/** Settings UI grouping; also decides the order rows are shown in. */
export type CueGroup = "connection" | "people" | "self" | "chat" | "toggles";

interface CueEventMeta {
  group: CueGroup;
  /** False for events the user triggers themselves; see the file comment. */
  notifiable: boolean;
  defaults: CueEventSettings;
}

/**
 * Defaults follow TS3: connection changes, pokes, private messages, being
 * moved/kicked/banned and the mute toggles make a sound; server-wide joins and plain
 * channel/server chat stay quiet (on a busy server they would never stop).
 * Desktop notifications default on only for things that need you back at the
 * tab: pokes, private messages, being kicked, banned or dropped.
 */
export const CUE_META: Record<CueEvent, CueEventMeta> = {
  connected: { group: "connection", notifiable: true, defaults: { sound: true, notify: false } },
  disconnected: {
    group: "connection",
    notifiable: true,
    defaults: { sound: true, notify: false },
  },
  connectionLost: {
    group: "connection",
    notifiable: true,
    defaults: { sound: true, notify: true },
  },
  kickedFromServer: {
    group: "connection",
    notifiable: true,
    defaults: { sound: true, notify: true },
  },
  banned: {
    group: "connection",
    notifiable: true,
    defaults: { sound: true, notify: true },
  },
  channelUserJoined: {
    group: "people",
    notifiable: true,
    defaults: { sound: true, notify: false },
  },
  channelUserLeft: {
    group: "people",
    notifiable: true,
    defaults: { sound: true, notify: false },
  },
  serverUserJoined: {
    group: "people",
    notifiable: true,
    defaults: { sound: false, notify: false },
  },
  serverUserLeft: {
    group: "people",
    notifiable: true,
    defaults: { sound: false, notify: false },
  },
  // TS3 sounds it too: a whisper is meant for you, but a popup for every one
  // would bury the screen during a raid.
  whisperReceived: { group: "people", notifiable: true, defaults: { sound: true, notify: false } },
  movedByOther: { group: "self", notifiable: true, defaults: { sound: true, notify: true } },
  kickedFromChannel: { group: "self", notifiable: true, defaults: { sound: true, notify: true } },
  talkPowerGranted: { group: "self", notifiable: true, defaults: { sound: true, notify: false } },
  talkPowerRevoked: { group: "self", notifiable: true, defaults: { sound: true, notify: false } },
  poked: { group: "chat", notifiable: true, defaults: { sound: true, notify: true } },
  privateMessage: { group: "chat", notifiable: true, defaults: { sound: true, notify: true } },
  channelMessage: { group: "chat", notifiable: true, defaults: { sound: false, notify: false } },
  serverMessage: { group: "chat", notifiable: true, defaults: { sound: false, notify: false } },
  micMuted: { group: "toggles", notifiable: false, defaults: { sound: true, notify: false } },
  micUnmuted: { group: "toggles", notifiable: false, defaults: { sound: true, notify: false } },
  speakersMuted: { group: "toggles", notifiable: false, defaults: { sound: true, notify: false } },
  speakersUnmuted: {
    group: "toggles",
    notifiable: false,
    defaults: { sound: true, notify: false },
  },
  awayOn: { group: "toggles", notifiable: false, defaults: { sound: true, notify: false } },
  awayOff: { group: "toggles", notifiable: false, defaults: { sound: true, notify: false } },
};

export const CUE_GROUPS: CueGroup[] = ["connection", "people", "self", "chat", "toggles"];

export function eventsInGroup(group: CueGroup): CueEvent[] {
  return CUE_EVENTS.filter((e) => CUE_META[e].group === group);
}

export function isCueEvent(value: unknown): value is CueEvent {
  return typeof value === "string" && (CUE_EVENTS as readonly string[]).includes(value);
}

export interface NotifySettings {
  /** Master switch for every cue sound. */
  sounds: boolean;
  /** Master switch for desktop notifications (the browser permission is separate). */
  notifications: boolean;
  /** Cue loudness, 0..1, independent of the voice output volume. */
  volume: number;
  events: Record<CueEvent, CueEventSettings>;
}

export const DEFAULT_VOLUME = 0.5;

export function defaultSettings(): NotifySettings {
  const events = {} as Record<CueEvent, CueEventSettings>;
  for (const e of CUE_EVENTS) events[e] = { ...CUE_META[e].defaults };
  return { sounds: true, notifications: false, volume: DEFAULT_VOLUME, events };
}

/**
 * Folds whatever was saved into the defaults. Saved data may come from an
 * older build (missing events), a newer one (unknown events) or be garbage, so
 * every field is checked instead of trusting the shape.
 */
export function mergeSettings(saved: unknown): NotifySettings {
  const out = defaultSettings();
  if (!saved || typeof saved !== "object") return out;
  const s = saved as Record<string, unknown>;
  if (typeof s.sounds === "boolean") out.sounds = s.sounds;
  if (typeof s.notifications === "boolean") out.notifications = s.notifications;
  if (typeof s.volume === "number" && Number.isFinite(s.volume)) {
    out.volume = Math.max(0, Math.min(1, s.volume));
  }
  const events = s.events;
  if (events && typeof events === "object") {
    for (const [key, value] of Object.entries(events as Record<string, unknown>)) {
      if (!isCueEvent(key) || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      out.events[key] = {
        sound: typeof v.sound === "boolean" ? v.sound : out.events[key].sound,
        notify: typeof v.notify === "boolean" ? v.notify : out.events[key].notify,
      };
    }
  }
  return out;
}
