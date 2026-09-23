/**
 * Whispering: talking to chosen channels and clients instead of one's own
 * channel.
 *
 * The browser names the targets once, with `whisper.set`, when the whisper key
 * goes down, then streams `VoiceFrameKind.UpWhisper` frames. The hub checks the
 * targets against that session's own channel tree before it builds a single
 * TeamSpeak whisper packet from them, and answers with the ones it kept
 * (`whisper.target`).
 */
import { z } from "zod";

/**
 * Channels plus clients one whisper may name. A TeamSpeak whisper header
 * could carry 255 of each; a hub fanning one browser's voice out to that many
 * targets is a flood, not a whisper.
 */
export const WHISPER_MAX_TARGETS = 32;

const channelIdSchema = z.string().regex(/^\d+$/, "channel id must be a decimal string");
const clientIdSchema = z.number().int().min(0).max(65535);

export const WhisperTargetSchema = z
  .object({
    channels: z.array(channelIdSchema).max(WHISPER_MAX_TARGETS),
    clients: z.array(clientIdSchema).max(WHISPER_MAX_TARGETS),
  })
  .refine((t) => t.channels.length + t.clients.length <= WHISPER_MAX_TARGETS, {
    message: `at most ${WHISPER_MAX_TARGETS} whisper targets`,
  });

export type WhisperTarget = z.infer<typeof WhisperTargetSchema>;

/** Browser -> hub: who whispered frames go to from now on; null stops whispering. */
export const WhisperSetSchema = z.object({
  type: z.literal("whisper.set"),
  target: WhisperTargetSchema.nullable(),
});

/**
 * Hub -> browser: the targets the hub kept after checking them against the
 * tree (gone channels, clients out of view and ourselves are dropped). Both
 * empty means nothing will be whispered.
 */
export interface WhisperTargetMessage {
  type: "whisper.target";
  channels: string[];
  clients: number[];
}
