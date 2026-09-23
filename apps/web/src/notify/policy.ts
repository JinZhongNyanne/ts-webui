/**
 * The rules that decide whether a cue is heard or shown, kept apart from the
 * store so they can be tested without a browser.
 *
 * How cues share the stage with the other announcers:
 *
 * - Someone with their own entry sound (profiles store) walking into our
 *   channel already makes a noise; the join chime would talk over it, so it is
 *   skipped for them.
 * - When TTS is on and set to read an event (join/leave, pokes, a chat kind),
 *   the spoken line *is* the announcement, so the chime for it is skipped.
 * - Desktop notifications are visual and never collide with either, so these
 *   rules only touch sounds.
 */
import type { Cue } from "./cues";
import type { CueEvent } from "./events";

export interface AnnouncerState {
  /** TTS is switched on at all. */
  ttsEnabled: boolean;
  ttsReadsJoinLeave: boolean;
  ttsReadsPokes: boolean;
  ttsReadsChannelChat: boolean;
  ttsReadsServerChat: boolean;
  ttsReadsPrivateChat: boolean;
  /** Whether a UID has a custom channel-entry sound. */
  hasEntrySound: (uid: string) => boolean;
}

/** True when another announcer already covers this cue, so its sound is skipped. */
export function soundCoveredElsewhere(cue: Cue, a: AnnouncerState): boolean {
  if (cue.event === "channelUserJoined" && cue.uid && a.hasEntrySound(cue.uid)) return true;
  if (!a.ttsEnabled) return false;
  switch (cue.event) {
    case "channelUserJoined":
    case "channelUserLeft":
      return a.ttsReadsJoinLeave;
    case "poked":
      return a.ttsReadsPokes;
    case "channelMessage":
      return a.ttsReadsChannelChat;
    case "serverMessage":
      return a.ttsReadsServerChat;
    case "privateMessage":
      return a.ttsReadsPrivateChat;
    default:
      return false;
  }
}

export interface PageAttention {
  /** `document.visibilityState === "hidden"`. */
  hidden: boolean;
  /** `document.hasFocus()`. */
  focused: boolean;
}

/**
 * Desktop notifications are for when the user is somewhere else: another tab,
 * another window, minimised. A visible, focused page already shows the event in
 * its own log, so a system popup on top would only be noise.
 */
export function wantsDesktopNotification(page: PageAttention): boolean {
  return page.hidden || !page.focused;
}

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

/** Notification.permission, or "unsupported" where the API is missing (http, old browsers). */
export function notificationPermission(
  api: { permission: NotificationPermission } | undefined,
): PermissionState {
  return api ? api.permission : "unsupported";
}

/** Same event again inside this window is dropped (a mass move is one chime, not twenty). */
export const CUE_REPEAT_MS = 300;

/** Longest body a notification gets; the OS truncates anyway, and inconsistently. */
export const NOTIFICATION_BODY_MAX = 160;

/**
 * Body line for a desktop notification: "name: text", with BBCode tags
 * stripped (the OS shows them literally) and the length capped.
 */
export function notificationBody(cue: Cue): string {
  const text = (cue.text ?? "")
    .replace(/\[\/?[a-z*]+(=[^\]]*)?\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const line = cue.name && text ? `${cue.name}: ${text}` : cue.name || text;
  return line.length > NOTIFICATION_BODY_MAX
    ? `${line.slice(0, NOTIFICATION_BODY_MAX - 1)}…`
    : line;
}

/**
 * Remembers when each event last played. Returns false for a repeat inside the
 * window; the window restarts only on cues that were let through, so a steady
 * stream still sounds every CUE_REPEAT_MS instead of going silent.
 */
export function createThrottle(
  windowMs = CUE_REPEAT_MS,
): (event: CueEvent, now: number) => boolean {
  const last = new Map<CueEvent, number>();
  return (event, now) => {
    const prev = last.get(event);
    if (prev !== undefined && now - prev < windowMs) return false;
    last.set(event, now);
    return true;
  };
}
