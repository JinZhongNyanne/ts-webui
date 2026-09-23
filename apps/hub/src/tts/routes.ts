/**
 * Text-to-speech via Microsoft Edge's free "Read Aloud" neural voices
 * (msedge-tts). The browser plays the returned MP3 locally; nothing is sent
 * into the TeamSpeak channel.
 */
import type { FastifyInstance } from "fastify";
import { MsEdgeTTS, OUTPUT_FORMAT, type Voice } from "msedge-tts";
import type { Logger } from "../logger.js";
import type { AssetRegistry } from "../session/asset-registry.js";
import type { RateLimiter } from "../security/limits.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

const MAX_TEXT = 500;
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

let voicesCache: { at: number; voices: Voice[] } | null = null;

async function listVoices(): Promise<Voice[]> {
  if (voicesCache && Date.now() - voicesCache.at < 6 * 3600_000) return voicesCache.voices;
  const tts = new MsEdgeTTS();
  const voices = await tts.getVoices();
  voicesCache = { at: Date.now(), voices };
  return voices;
}

/** Turns text into MP3 bytes; injectable so tests never reach Microsoft. */
export type Synthesizer = (text: string, voice: string, rate: string) => Promise<Buffer>;

export const synthesize: Synthesizer = async (text, voice, rate) => {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on("end", () => resolve());
      audioStream.on("error", reject);
    });
    return Buffer.concat(chunks);
  } finally {
    // The websocket to Edge stays open otherwise, leaking a socket per failure.
    tts.close();
  }
};

export interface TtsRouteDeps {
  registry: AssetRegistry;
  logger: Logger;
  limiter?: RateLimiter;
  /** Defaults to the real Edge synthesizer. */
  synthesize?: Synthesizer;
}

export function registerTtsRoutes(app: AnyFastify, deps: TtsRouteDeps): void {
  const synth = deps.synthesize ?? synthesize;
  /** Voices grouped for the settings UI (Chinese first). */
  app.get("/api/tts/voices", async (_req, reply) => {
    try {
      const voices = await listVoices();
      const slim = voices
        .map((v) => ({
          name: v.ShortName,
          friendly: v.FriendlyName.replace(/^Microsoft /, "").replace(/ Online \(Natural\)/, ""),
          locale: v.Locale,
          gender: v.Gender,
        }))
        .sort((a, b) => {
          const za = a.locale.startsWith("zh") ? 0 : 1;
          const zb = b.locale.startsWith("zh") ? 0 : 1;
          return za - zb || a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name);
        });
      return reply.header("cache-control", "public, max-age=3600").send({ voices: slim });
    } catch (err) {
      deps.logger.warn({ err }, "tts voices failed");
      return reply.code(502).send({ error: "无法获取语音列表" });
    }
  });

  /**
   * GET /api/tts/speak?text=...&voice=...&rate=+0%&token=...  -> audio/mpeg
   *
   * An `<audio>` tag loads this, so the URL carries a short-lived asset token
   * rather than the session id.
   */
  app.get<{ Querystring: { text?: string; voice?: string; rate?: string; token?: string } }>(
    "/api/tts/speak",
    async (request, reply) => {
      const q = request.query;
      // Only connected users may spend TTS bandwidth through this hub.
      const session = deps.registry.getConnectedByAssetToken(q.token);
      if (!session) {
        return reply.code(401).send({ error: "connect first" });
      }
      // Every synthesis is a request to Microsoft made in this hub's name.
      if (deps.limiter && !deps.limiter.take(session.id)) {
        return reply.code(429).send({ error: "too many requests" });
      }
      const text = (q.text ?? "").trim().slice(0, MAX_TEXT);
      if (!text) return reply.code(400).send({ error: "text required" });
      const voice = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+$/.test(q.voice ?? "")
        ? q.voice!
        : DEFAULT_VOICE;
      const rate = /^[+-]\d{1,3}%$/.test(q.rate ?? "") ? q.rate! : "+0%";
      try {
        const buf = await synth(text, voice, rate);
        return reply
          .header("content-type", "audio/mpeg")
          .header("cache-control", "no-store")
          .send(buf);
      } catch (err) {
        deps.logger.warn({ err, voice }, "tts synth failed");
        return reply.code(502).send({ error: "语音合成失败" });
      }
    },
  );
}
