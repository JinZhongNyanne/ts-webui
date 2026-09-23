import type { media as source } from "../zh-CN/media";

/** English strings for file transfers, media streaming and the viewer. Keys mirror `../zh-CN/media.ts`. */
export const media: Record<keyof typeof source, string> = {
  "media.notMedia": "Only video and audio files can be played here",
};
