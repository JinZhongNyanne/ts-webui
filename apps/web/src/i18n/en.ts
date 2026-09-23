/**
 * English strings. Keys mirror `zh-CN.ts`, which is the source locale.
 *
 * Composed from partials under `en/`, each the English half of a pair with the
 * file of the same name under `zh-CN/`. A feature owns its pair and adds keys
 * only there. **Never edit this file to add a key**; see `zh-CN.ts` for why.
 *
 * Each partial is typed by its Chinese twin's keys, and the whole catalogue by
 * `Messages`, so a key missing from English fails the typecheck both in the
 * partial and here.
 */
import type { Messages } from "./zh-CN";
import { core } from "./en/core";
import { whisper } from "./en/whisper";
import { server } from "./en/server";
import { media } from "./en/media";
import { misc } from "./en/misc";

export const en: Messages = {
  ...core,
  ...whisper,
  ...server,
  ...media,
  ...misc,
};
