import type { misc as source } from "../zh-CN/misc";

/** English strings for small items that belong to no larger feature (PWA, client preferences and so on). Keys mirror `../zh-CN/misc.ts`. */
export const misc: Record<keyof typeof source, string> = {
  "sound.blockNoTalkPower":
    "You have no talk power in this channel, so sounds are not sent. Use 🎧 to preview.",
};
