/**
 * The away-message presets a user keeps for quick picks ("brb", "lunch"...).
 * Stored per browser; `null` means "never edited", which shows the built-in
 * defaults in the current language rather than freezing whichever language
 * was active on the first visit.
 */
import { AWAY_MESSAGE_MAX } from "./client-features";

export const MAX_AWAY_PRESETS = 8;

/** Trimmed, non-empty, at most 80 characters, no duplicates, at most 8. */
export function normalizePresets(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, AWAY_MESSAGE_MAX);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_AWAY_PRESETS) break;
  }
  return out;
}

/** Adds `text` in front (moving it there if it exists); the oldest falls off past the cap. */
export function addPreset(list: readonly string[], text: string): string[] {
  const clean = text.trim().slice(0, AWAY_MESSAGE_MAX);
  if (!clean) return [...list];
  return [clean, ...list.filter((p) => p !== clean)].slice(0, MAX_AWAY_PRESETS);
}

export function removePreset(list: readonly string[], text: string): string[] {
  return list.filter((p) => p !== text);
}
