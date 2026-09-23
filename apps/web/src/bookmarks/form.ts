/**
 * Conversions between the connect dialog's profile, bookmarks and recent
 * entries, kept apart from the components so they stay trivial to test.
 */
import type { RecentConnection } from "./book";

/** Clear-text bookmark as edited in the UI (passwords are sealed on save). */
export interface BookmarkForm {
  id?: string;
  label: string;
  group: string;
  host: string;
  port: number;
  nickname: string;
  identityId: string | null;
  defaultChannel: string;
  musicBot: string;
  serverPassword: string;
  channelPassword: string;
}

/** The connect-dialog fields a bookmark fills in. */
export interface ProfileFields {
  host: string;
  port: number;
  nickname: string;
  serverPassword: string;
  defaultChannel: string;
  musicBot: string;
  defaultChannelPassword?: string;
}

export function formFromProfile(
  p: ProfileFields,
  identityId: string | null,
  currentChannel = "",
): BookmarkForm {
  return {
    label: p.host,
    group: "",
    host: p.host,
    port: p.port,
    nickname: p.nickname,
    identityId,
    // Where we are now is the more useful default than where we started.
    defaultChannel: currentChannel || p.defaultChannel,
    musicBot: p.musicBot,
    serverPassword: p.serverPassword,
    channelPassword: currentChannel ? "" : (p.defaultChannelPassword ?? ""),
  };
}

export function formFromRecent(r: RecentConnection): BookmarkForm {
  return {
    label: r.host,
    group: "",
    host: r.host,
    port: r.port,
    nickname: r.nickname,
    identityId: r.identityId,
    defaultChannel: r.defaultChannel,
    musicBot: r.musicBot,
    serverPassword: "",
    channelPassword: "",
  };
}

/**
 * What picking a bookmark does to the dialog: every server field replaced,
 * and the nickname only when the bookmark has one (else the identity's preset
 * or what the user typed stays).
 */
export function applyToProfile<T extends ProfileFields>(profile: T, f: BookmarkForm): T {
  return {
    ...profile,
    host: f.host,
    port: f.port,
    nickname: f.nickname || profile.nickname,
    serverPassword: f.serverPassword,
    defaultChannel: f.defaultChannel,
    defaultChannelPassword: f.channelPassword,
    musicBot: f.musicBot,
  };
}
