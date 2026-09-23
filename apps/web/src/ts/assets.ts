import { assetToken, hasAssetToken } from "./asset-token";
import { locale, t } from "../i18n";
import { renderBBCode as renderBBCodeHtml } from "./bbcode";
import { useChatSettingsStore } from "../stores/chatSettings";
import { useHubAccessStore } from "../stores/hubAccess";
import { useTsStore } from "../stores/ts";
import { DEFAULT_TS_PORT } from "../chat/files/ts3file";
import { linkIsHere, type ServerAddress } from "../chat/files/same-server";

/**
 * The addresses native clients may know this server by: what this page
 * connected to, or, with a fixed server, the public address the hub names
 * (and the page's own host, which older links were written with).
 */
function serverAddresses(): readonly ServerAddress[] {
  const access = useHubAccessStore();
  if (access.fixedServer) {
    const listed = access.publicServer ? [access.publicServer] : [];
    return [...listed, { host: location.hostname }];
  }
  const { host, port } = useTsStore().profile;
  return host ? [{ host, port: port || DEFAULT_TS_PORT }] : [];
}

/**
 * TeamSpeak's built-in group icons (ids < 1000) ship with the client and are not
 * stored on the server, so they cannot be downloaded. Map them to glyphs.
 */
const BUILTIN_ICONS: Record<number, { glyph: string; label: string }> = {
  100: { glyph: "🛡️", label: "Channel Admin" },
  200: { glyph: "🔧", label: "Operator" },
  300: { glyph: "🎤", label: "Voice" },
  400: { glyph: "👥", label: "Guest" },
  500: { glyph: "⭐", label: "Server Admin" },
  600: { glyph: "👤", label: "Normal" },
};

export function builtinIcon(iconId: number | undefined): { glyph: string; label: string } | null {
  if (!iconId) return null;
  return BUILTIN_ICONS[iconId >>> 0] ?? null;
}

/**
 * URL of a TeamSpeak icon by id, served (and cached) by the hub. Null when none,
 * built-in, or no asset token is held yet. The token is read outside reactivity
 * so a rotation does not rebuild every image; only its presence is tracked.
 */
export function iconUrl(iconId: number | undefined): string | null {
  if (!iconId) return null;
  if (!hasAssetToken.value) return null;
  const unsigned = iconId >>> 0;
  // Icons with ids below 1000 are built-in client sprites the server does not store.
  if (unsigned === 0 || unsigned < 1000) return null;
  return `/api/ts/${encodeURIComponent(assetToken())}/icon/${unsigned}`;
}

/** URL of a client's avatar, or null when the client has none. */
export function avatarUrl(flagAvatar: string | undefined): string | null {
  if (!flagAvatar) return null;
  if (!hasAssetToken.value) return null;
  return `/api/ts/${encodeURIComponent(assetToken())}/avatar/${encodeURIComponent(flagAvatar)}`;
}

/** Turns an ISO 3166 alpha-2 country code into a flag emoji, e.g. "CN" -> 🇨🇳. */
export function countryFlag(code: string | undefined): string {
  if (!code || code.length !== 2 || !/^[A-Za-z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  const cc = code.toUpperCase();
  return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65));
}

/** Country names come from the platform, so every locale gets them for free. */
export function countryName(code: string | undefined): string {
  if (!code) return "";
  const cc = code.toUpperCase();
  try {
    const names = new Intl.DisplayNames([locale.value], { type: "region" });
    return names.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Formats a unix-seconds timestamp as a local date-time. */
export function formatDateTime(unixSeconds: number): string {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toLocaleString(locale.value, { hour12: false });
}

/** Formats a duration in seconds as "Nd Nh Nm". */
export function formatUptime(seconds: number): string {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(t("time.days", { n: d }));
  if (h) parts.push(t("time.hours", { n: h }));
  parts.push(t("time.minutes", { n: m }));
  return parts.join(" ");
}

/**
 * Renders TeamSpeak BBCode to safe HTML (see `bbcode.ts`), with translated
 * labels and this browser's image allowlist. Reads the allowlist reactively,
 * so allowing a host re-renders every message that shows its images.
 */
export function renderBBCode(input: string): string {
  const chat = useChatSettingsStore();
  return renderBBCodeHtml(input, {
    loadImage: (host) => chat.isImageHostAllowed(host),
    labels: {
      loadImage: (host) => t("bbcode.loadImage", { host }),
      alwaysLoad: (host) => t("bbcode.alwaysLoad", { host }),
    },
    fileLabels: {
      download: t("chatFiles.download"),
      preview: t("chatFiles.preview"),
      play: t("chatFiles.play"),
      elsewhere: (host) => t("chatFiles.otherServer", { host }),
    },
    fileHere: (file) => linkIsHere(file, serverAddresses()),
    formatTime: (d) => d.toLocaleString(locale.value, { hour12: false }),
  });
}
