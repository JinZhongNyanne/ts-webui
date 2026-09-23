/**
 * Chat preferences kept in this browser: local history, the hosts whose
 * `[img]` pictures load without asking, and whether small pictures shared
 * through the hub show themselves. Pure so the validation is testable;
 * `stores/chatSettings.ts` makes it reactive and persists it.
 *
 * localStorage is user-editable (and survives app versions), so whatever comes
 * back from it goes through `normalizeChatSettings` before it is trusted.
 */

export interface ChatSettings {
  historyEnabled: boolean;
  /** Days a stored message is kept; 0 keeps it until the per-conversation cap pushes it out. */
  retentionDays: number;
  /** Hosts (`name` or `name:port`, lower case) whose images load right away. */
  imageHosts: readonly string[];
  /** Show small pictures shared in chat as stickers, without a click (see files/auto-preview.ts). */
  autoImages: boolean;
}

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;
/** Nobody curates hundreds of hosts by hand; the cap keeps a bad import in check. */
export const MAX_IMAGE_HOSTS = 200;

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  historyEnabled: true,
  retentionDays: DEFAULT_RETENTION_DAYS,
  imageHosts: [],
  autoImages: true,
};

const HOST_RE =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;
const IPV6_HOST_RE = /^\[[0-9a-f:.]+\](:\d{1,5})?$/;

/** A host as `URL.host` writes it (lower case), or null when it is not one. */
export function normalizeHost(host: string): string | null {
  const h = host.trim().toLowerCase();
  return HOST_RE.test(h) || IPV6_HOST_RE.test(h) ? h : null;
}

export function clampRetention(days: unknown): number {
  const n = typeof days === "number" ? days : Number(days);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(0, Math.round(n)));
}

export function normalizeChatSettings(raw: unknown): ChatSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_CHAT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const hosts = Array.isArray(r.imageHosts)
    ? r.imageHosts.flatMap((h) => (typeof h === "string" ? (normalizeHost(h) ?? []) : []))
    : [];
  return {
    historyEnabled:
      typeof r.historyEnabled === "boolean"
        ? r.historyEnabled
        : DEFAULT_CHAT_SETTINGS.historyEnabled,
    retentionDays:
      r.retentionDays === undefined ? DEFAULT_RETENTION_DAYS : clampRetention(r.retentionDays),
    imageHosts: [...new Set(hosts)].slice(0, MAX_IMAGE_HOSTS),
    autoImages: typeof r.autoImages === "boolean" ? r.autoImages : DEFAULT_CHAT_SETTINGS.autoImages,
  };
}

export function withImageHost(s: ChatSettings, host: string): ChatSettings {
  const h = normalizeHost(host);
  if (!h || s.imageHosts.includes(h) || s.imageHosts.length >= MAX_IMAGE_HOSTS) return s;
  return { ...s, imageHosts: [...s.imageHosts, h] };
}

export function withoutImageHost(s: ChatSettings, host: string): ChatSettings {
  const h = host.trim().toLowerCase();
  return { ...s, imageHosts: s.imageHosts.filter((x) => x !== h) };
}
