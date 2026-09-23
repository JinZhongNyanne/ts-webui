import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_SOUND_BYTES, isSoundVolume, normalizeSoundName, sniffSoundType } from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { sessionIdFromHeaders, type AssetRegistry } from "../session/asset-registry.js";
import type { RateLimiter } from "../security/limits.js";
import type { SoundStore } from "./store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export interface SoundRegistry extends AssetRegistry {
  values(): Iterable<Session>;
}

export interface SoundRouteDeps {
  store: SoundStore;
  registry: SoundRegistry;
  /** Budget for uploading, editing and deleting, per session. */
  limiter?: RateLimiter;
}

/** The upload's type is judged from its bytes, so the page sends them untyped. */
const UPLOAD_TYPE = "application/octet-stream";

const PatchBody = z
  .object({
    name: z.string().max(256).optional(),
    volume: z.unknown().optional(),
  })
  .strict();

/**
 * The soundboard, shared by everyone on the hub.
 *
 * Any connected user may upload, rename, re-level or delete a clip (a hub is
 * a group of people who know each other, and the board is theirs); every
 * change is pushed to every connected session as `sounds.updated`. An upload
 * is the raw file as `application/octet-stream` with the name in the query;
 * what it is comes from its first bytes, never from what the browser claims,
 * and the file is stored under a server-made id. Files are served from the
 * hub's origin (with `nosniff`, see security/headers.ts) under an asset
 * token, since the page decodes them with a plain fetch of a URL, like the
 * other hub-served media.
 */
export function registerSoundRoutes(app: AnyFastify, deps: SoundRouteDeps): void {
  const { store, registry } = deps;

  app.addContentTypeParser(
    UPLOAD_TYPE,
    { parseAs: "buffer", bodyLimit: MAX_SOUND_BYTES },
    (_req, body, done) => done(null, body),
  );

  function broadcast(): void {
    const msg = { type: "sounds.updated" as const, sounds: store.list() };
    for (const session of registry.values()) {
      if (registry.getConnected(session.id)) session.send(msg);
    }
  }

  /** The connected session a write comes from, within its budget; else the status to refuse with. */
  function writer(
    headers: Parameters<typeof sessionIdFromHeaders>[0],
  ): Session | { code: 401 | 429; error: string } {
    const session = registry.getConnected(sessionIdFromHeaders(headers));
    if (!session) return { code: 401, error: "not connected" };
    if (deps.limiter && !deps.limiter.take(session.id)) {
      return { code: 429, error: "too many requests" };
    }
    return session;
  }

  app.get("/api/sounds", async (request, reply) => {
    if (!registry.getConnected(sessionIdFromHeaders(request.headers))) {
      return reply.code(401).send({ error: "not connected" });
    }
    return { sounds: store.list() };
  });

  app.post<{ Querystring: { name?: string } }>("/api/sounds", async (request, reply) => {
    const session = writer(request.headers);
    if ("code" in session) return reply.code(session.code).send({ error: session.error });
    const name = normalizeSoundName(request.query.name ?? "");
    if (!name) return reply.code(400).send({ error: "name" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "empty" });
    }
    const type = sniffSoundType(body.subarray(0, 4096));
    if (!type) return reply.code(415).send({ error: "type" });

    const result = store.add(name, body, type, session.tsSession?.selfNickname ?? "");
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    broadcast();
    return reply.code(201).send({ sound: result.sound });
  });

  app.patch<{ Params: { id: string } }>("/api/sounds/:id", async (request, reply) => {
    const session = writer(request.headers);
    if ("code" in session) return reply.code(session.code).send({ error: session.error });
    const body = PatchBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid" });
    const { name: rawName, volume } = body.data;
    if (rawName === undefined && volume === undefined) {
      return reply.code(400).send({ error: "invalid" });
    }
    const name = rawName === undefined ? undefined : normalizeSoundName(rawName);
    if (name === null) return reply.code(400).send({ error: "name" });
    if (volume !== undefined && !isSoundVolume(volume)) {
      return reply.code(400).send({ error: "volume" });
    }
    const sound = store.update(request.params.id, { name, volume });
    if (!sound) return reply.code(404).send({ error: "not found" });
    broadcast();
    return { sound };
  });

  app.delete<{ Params: { id: string } }>("/api/sounds/:id", async (request, reply) => {
    const session = writer(request.headers);
    if ("code" in session) return reply.code(session.code).send({ error: session.error });
    if (!store.remove(request.params.id)) return reply.code(404).send({ error: "not found" });
    broadcast();
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/api/sound-file/:id",
    async (request, reply) => {
      // Media URLs cannot carry a header; an unknown token looks like a missing clip.
      if (!registry.getConnectedByAssetToken(request.query.token)) return reply.code(404).send();
      const file = store.read(request.params.id);
      if (!file) return reply.code(404).send();
      return (
        reply
          .header("content-type", file.contentType)
          // A clip's file never changes under its id (a new upload gets a new one).
          .header("cache-control", "private, max-age=604800, immutable")
          .send(file.body)
      );
    },
  );
}
