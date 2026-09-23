import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_STICKER_BYTES,
  isStickerScope,
  normalizeStickerName,
  sniffStickerType,
  type StickerSet,
} from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { sessionIdFromHeaders, type AssetRegistry } from "../session/asset-registry.js";
import type { RateLimiter } from "../security/limits.js";
import type { PackRemoval, StickerStore, StickerTarget } from "./store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

/** Sticker changes are pushed, so the roster needs listing too. */
export interface StickerRegistry extends AssetRegistry {
  values(): Iterable<Session>;
}

export interface StickerRouteDeps {
  store: StickerStore;
  registry: StickerRegistry;
  /** Budget for uploading, editing and deleting, per session. */
  limiter?: RateLimiter;
}

/** The upload's type is judged from its bytes, so the page sends them untyped. */
const UPLOAD_TYPE = "application/octet-stream";

const NameBody = z.object({ name: z.string().max(256) }).strict();

const StickerPatchBody = z
  .object({
    name: z.string().max(256).optional(),
    /** null moves it out of its pack, into "ungrouped". */
    packId: z.string().max(64).nullable().optional(),
  })
  .strict();

/** A write's answer when it may not go ahead. */
interface Refusal {
  code: 400 | 401 | 403 | 404 | 409 | 429;
  error: string;
}

const isRefusal = (value: object): value is Refusal => "code" in value;

/**
 * Stickers: small pictures kept on the hub and dropped into chat.
 *
 * Two scopes. `shared` works like the soundboard and the Apps list: any
 * connected user may add, rename, move and delete, and every change is pushed
 * to everyone as `stickers.updated`. `personal` belongs to one TeamSpeak
 * identity, taken from the caller's live session and never from the request,
 * so nobody can read or write another user's set; its changes go only to the
 * sessions of that identity, which is how the same user sees them on a second
 * device. An anonymous caller gets neither: a hub's stickers are nothing for
 * the internet to enumerate.
 *
 * An upload is the raw file as `application/octet-stream` with the name and
 * target pack in the query; what it is comes from its first bytes, never from
 * what the browser claims. The picture is stored once per hub under its
 * SHA-256 (see store.ts), and is served from the hub's origin (with `nosniff`,
 * see security/headers.ts) under an asset token, since an `<img>` tag can set
 * no header. That URL names the hash, so its answer never changes and may be
 * cached for a long time.
 */
export function registerStickerRoutes(app: AnyFastify, deps: StickerRouteDeps): void {
  const { store, registry } = deps;

  // The soundboard takes raw uploads too, and fastify allows one parser per
  // type; whichever registers first serves both, so the sticker cap is a
  // route-level bodyLimit (below) and a length check, not the parser's.
  if (!app.hasContentTypeParser(UPLOAD_TYPE)) {
    app.addContentTypeParser(
      UPLOAD_TYPE,
      { parseAs: "buffer", bodyLimit: MAX_STICKER_BYTES },
      (_req, body, done) => done(null, body),
    );
  }

  /** Shared sets reach every connected session; a personal one only its owner's. */
  function broadcast(target: StickerTarget): void {
    const set = store.list(target);
    const msg = { type: "stickers.updated" as const, set };
    for (const session of registry.values()) {
      if (!registry.getConnected(session.id)) continue;
      if (target.scope === "personal" && session.tsSession?.selfUid !== target.uid) continue;
      session.send(msg);
    }
  }

  /** The connected session a call comes from, within its budget when it writes. */
  function caller(
    headers: Parameters<typeof sessionIdFromHeaders>[0],
    write: boolean,
  ): Session | Refusal {
    const session = registry.getConnected(sessionIdFromHeaders(headers));
    if (!session) return { code: 401, error: "not connected" };
    if (write && deps.limiter && !deps.limiter.take(session.id)) {
      return { code: 429, error: "too many requests" };
    }
    return session;
  }

  /**
   * Whose set `scope` names for `session`. A personal scope resolves to the
   * caller's own identity and nothing else, so the request never says whose.
   */
  function targetFor(session: Session, scope: string): StickerTarget | Refusal {
    if (!isStickerScope(scope)) return { code: 404, error: "not found" };
    if (scope === "shared") return { scope };
    const uid = session.tsSession?.selfUid;
    // Without an identity there is no personal set to speak of.
    if (!uid) return { code: 403, error: "no identity" };
    return { scope, uid };
  }

  /** The connected caller's target for `scope`, or why the call is refused. */
  function resolve(
    headers: Parameters<typeof sessionIdFromHeaders>[0],
    scope: string,
    write: boolean,
  ): { session: Session; target: StickerTarget } | Refusal {
    const session = caller(headers, write);
    if (isRefusal(session)) return session;
    const target = targetFor(session, scope);
    if (isRefusal(target)) return target;
    return { session, target };
  }

  /* ----------------------------------------------------------- reading */

  app.get("/api/stickers", async (request, reply) => {
    const session = caller(request.headers, false);
    if (isRefusal(session)) return reply.code(session.code).send({ error: session.error });
    const uid = session.tsSession?.selfUid;
    const personal: StickerSet = uid
      ? store.list({ scope: "personal", uid })
      : { scope: "personal", packs: [], stickers: [] };
    return { shared: store.list({ scope: "shared" }), personal };
  });

  app.get<{ Params: { hash: string }; Querystring: { token?: string } }>(
    "/api/sticker-file/:hash",
    async (request, reply) => {
      // Media URLs cannot carry a header; an unknown token looks like a missing picture.
      if (!registry.getConnectedByAssetToken(request.query.token)) return reply.code(404).send();
      const file = store.read(request.params.hash);
      if (!file) return reply.code(404).send();
      return (
        reply
          .header("content-type", file.contentType)
          // The URL is the picture's hash, so these bytes are it, for good.
          .header("cache-control", "private, max-age=604800, immutable")
          .send(file.body)
      );
    },
  );

  /* ---------------------------------------------------------- stickers */

  app.post<{ Params: { scope: string }; Querystring: { name?: string; pack?: string } }>(
    "/api/stickers/:scope",
    { bodyLimit: MAX_STICKER_BYTES },
    async (request, reply) => {
      const who = resolve(request.headers, request.params.scope, true);
      if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
      const name = normalizeStickerName(request.query.name ?? "");
      if (!name) return reply.code(400).send({ error: "name" });
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.code(400).send({ error: "empty" });
      }
      // A parser someone else registered may allow more than a sticker may be.
      if (body.length > MAX_STICKER_BYTES) {
        return reply.code(413).send({ error: "tooBig", maxBytes: MAX_STICKER_BYTES });
      }
      const contentType = sniffStickerType(body.subarray(0, 64));
      if (!contentType) return reply.code(415).send({ error: "type" });

      const packId = request.query.pack ? request.query.pack : null;
      const result = store.addSticker(who.target, {
        name,
        packId,
        body,
        contentType,
        addedBy: who.session.tsSession?.selfNickname ?? "",
      });
      if (!result.ok) {
        return reply.code(result.reason === "full" ? 409 : 400).send({ error: result.reason });
      }
      broadcast(who.target);
      return reply.code(201).send({ sticker: result.sticker });
    },
  );

  app.patch<{ Params: { scope: string; id: string } }>(
    "/api/stickers/:scope/:id",
    async (request, reply) => {
      const who = resolve(request.headers, request.params.scope, true);
      if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
      const parsed = StickerPatchBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid" });
      const { name: rawName, packId } = parsed.data;
      if (rawName === undefined && packId === undefined) {
        return reply.code(400).send({ error: "invalid" });
      }
      const name = rawName === undefined ? undefined : normalizeStickerName(rawName);
      if (name === null) return reply.code(400).send({ error: "name" });

      const sticker = store.updateSticker(who.target, request.params.id, { name, packId });
      if (sticker === "pack") return reply.code(400).send({ error: "pack" });
      if (!sticker) return reply.code(404).send({ error: "not found" });
      broadcast(who.target);
      return { sticker };
    },
  );

  app.delete<{ Params: { scope: string; id: string } }>(
    "/api/stickers/:scope/:id",
    async (request, reply) => {
      const who = resolve(request.headers, request.params.scope, true);
      if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
      if (!store.removeSticker(who.target, request.params.id)) {
        return reply.code(404).send({ error: "not found" });
      }
      broadcast(who.target);
      return reply.code(204).send();
    },
  );

  /* ------------------------------------------------------------- packs */

  app.post<{ Params: { scope: string } }>("/api/sticker-packs/:scope", async (request, reply) => {
    const who = resolve(request.headers, request.params.scope, true);
    if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
    const parsed = NameBody.safeParse(request.body);
    const name = parsed.success ? normalizeStickerName(parsed.data.name) : null;
    if (!name) return reply.code(400).send({ error: "name" });
    const result = store.addPack(who.target, name);
    if (!result.ok) {
      return reply.code(result.reason === "full" ? 409 : 400).send({ error: result.reason });
    }
    broadcast(who.target);
    return reply.code(201).send({ pack: result.pack });
  });

  app.patch<{ Params: { scope: string; id: string } }>(
    "/api/sticker-packs/:scope/:id",
    async (request, reply) => {
      const who = resolve(request.headers, request.params.scope, true);
      if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
      const parsed = NameBody.safeParse(request.body);
      const name = parsed.success ? normalizeStickerName(parsed.data.name) : null;
      if (!name) return reply.code(400).send({ error: "name" });
      const pack = store.renamePack(who.target, request.params.id, name);
      if (pack === "duplicate") return reply.code(400).send({ error: "duplicate" });
      if (!pack) return reply.code(404).send({ error: "not found" });
      broadcast(who.target);
      return { pack };
    },
  );

  app.delete<{ Params: { scope: string; id: string }; Querystring: { stickers?: string } }>(
    "/api/sticker-packs/:scope/:id",
    async (request, reply) => {
      const who = resolve(request.headers, request.params.scope, true);
      if (isRefusal(who)) return reply.code(who.code).send({ error: who.error });
      const wanted = request.query.stickers ?? "ungroup";
      if (wanted !== "ungroup" && wanted !== "delete") {
        return reply.code(400).send({ error: "stickers" });
      }
      const removal: PackRemoval = wanted;
      if (!store.removePack(who.target, request.params.id, removal)) {
        return reply.code(404).send({ error: "not found" });
      }
      broadcast(who.target);
      return reply.code(204).send();
    },
  );
}
