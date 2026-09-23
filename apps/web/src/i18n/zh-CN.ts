/**
 * Chinese (Simplified) strings — the source locale, and so the definition of
 * every key the UI may ask `t()` for.
 *
 * The catalogue is a composition of partials under `zh-CN/`, one per feature,
 * each paired with a file of the same name under `en/`. The split exists so
 * that features developed in parallel never edit the same file: a feature owns
 * its pair of partials and adds keys only there. **Never edit this file to add
 * a key.** It changes only when a whole new partial is introduced, which is
 * planned work, not something a feature does on the way past.
 *
 * `core` holds everything that predates the split. Keys are globally unique
 * across partials; `PartialClash` below turns a key defined twice into a type
 * error, because a spread would otherwise let the later partial silently win.
 */
import { core } from "./zh-CN/core";
import { whisper } from "./zh-CN/whisper";
import { server } from "./zh-CN/server";
import { media } from "./zh-CN/media";
import { misc } from "./zh-CN/misc";

export const zhCN = {
  ...core,
  ...whisper,
  ...server,
  ...media,
  ...misc,
} as const;

export type MessageKey = keyof typeof zhCN;
export type Messages = Record<MessageKey, string>;

type KeysOf<T extends readonly unknown[]> = T extends readonly [infer H, ...infer R]
  ? keyof H | KeysOf<R>
  : never;

/** Every key that appears in more than one of the listed partials. */
type Clashes<T extends readonly unknown[]> = T extends readonly [infer H, ...infer R]
  ? (keyof H & KeysOf<R>) | Clashes<R>
  : never;

/**
 * Resolves to `true` only when no key is defined twice. On a clash the
 * assertion below fails and the compiler names the offending key. Must list
 * the same partials as `zhCN`; the English partials are keyed by these, so
 * checking the Chinese side covers both.
 */
type PartialClash = Clashes<
  [typeof core, typeof whisper, typeof server, typeof media, typeof misc]
>;
type AssertNoClash<T extends never> = T;
export type NoPartialClash = AssertNoClash<PartialClash>;
