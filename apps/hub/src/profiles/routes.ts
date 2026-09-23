import type { FastifyInstance } from "fastify";
import type { UserProfile } from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { sessionIdFromHeaders, type AssetRegistry } from "../session/asset-registry.js";
import { ASSET_RULES, ProfileStore, type ProfileAsset } from "./store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

/** Profile changes are pushed to every open session, so the roster needs listing too. */
export interface ProfileRegistry extends AssetRegistry {
  values(): Iterable<Session>;
}

interface Deps {
  store: ProfileStore;
  registry: ProfileRegistry;
}

function assetOf(value: string): ProfileAsset | null {
  return value === "icon" || value === "sound" ? value : null;
}

/**
 * Per-user avatar icon and channel-entry sound.
 *
 * Reading takes a live session too: the roster is a list of who uses this hub
 * and what they uploaded, which is nothing for an anonymous caller from the
 * internet to enumerate. Any connected session sees everyone's icon.
 *
 * Calls the page makes with `fetch()` (roster, upload, delete) identify the
 * session through the `x-session-id` header; the asset itself is loaded by an
 * `<img>`/`<audio>` tag, which can set no header, so that URL carries a
 * short-lived read-only asset token (`?token=`) instead. No URL ever holds
 * the session id. Writing is limited to the caller's own TeamSpeak identity,
 * taken from their live session rather than from the request, so nobody can
 * overwrite another user's profile; the foreign-origin check on writes lives
 * in the server's request hook.
 */
export function registerProfileRoutes(app: AnyFastify, { store, registry }: Deps): void {
  const allTypes = [...ASSET_RULES.icon.types, ...ASSET_RULES.sound.types];
  const maxBytes = Math.max(ASSET_RULES.icon.maxBytes, ASSET_RULES.sound.maxBytes);
  for (const type of allTypes) {
    app.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: maxBytes }, (_req, body, done) =>
      done(null, body),
    );
  }

  function broadcast(profile: UserProfile): void {
    for (const session of registry.values()) session.send({ type: "profile.updated", profile });
  }

  app.get("/api/profiles", async (request, reply) => {
    if (!registry.getConnected(sessionIdFromHeaders(request.headers))) {
      return reply.code(401).send({ error: "not connected" });
    }
    return { profiles: store.list() };
  });

  app.get<{
    Params: { asset: string };
    Querystring: { uid?: string; rev?: string; token?: string };
  }>("/api/profile/:asset", async (request, reply) => {
    if (!registry.getConnectedByAssetToken(request.query.token)) {
      return reply.code(401).send({ error: "not connected" });
    }
    const asset = assetOf(request.params.asset);
    const uid = request.query.uid ?? "";
    if (!asset || !uid) return reply.code(400).send({ error: "bad request" });
    const file = store.read(uid, asset);
    if (!file) return reply.code(404).send({ error: "not found" });
    return (
      reply
        .header("content-type", file.contentType)
        // The URL carries a revision, so a hit may be cached indefinitely.
        .header("cache-control", "private, max-age=604800")
        .send(file.body)
    );
  });

  app.post<{ Params: { asset: string } }>("/api/profile/:asset", async (request, reply) => {
    const asset = assetOf(request.params.asset);
    if (!asset) return reply.code(404).send({ error: "not found" });
    const session = registry.getConnected(sessionIdFromHeaders(request.headers));
    const uid = session?.tsSession?.selfUid;
    if (!uid) return reply.code(401).send({ error: "not connected" });

    const rules = ASSET_RULES[asset];
    const contentType = (request.headers["content-type"] ?? "").split(";")[0]!.trim();
    if (!rules.types.includes(contentType)) {
      return reply.code(415).send({ error: "unsupported type", accepted: rules.types });
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "empty body" });
    }
    if (body.length > rules.maxBytes) {
      return reply.code(413).send({ error: "too large", maxBytes: rules.maxBytes });
    }
    const profile = store.save(uid, asset, body, contentType);
    broadcast(profile);
    return profile;
  });

  app.delete<{ Params: { asset: string } }>("/api/profile/:asset", async (request, reply) => {
    const asset = assetOf(request.params.asset);
    if (!asset) return reply.code(404).send({ error: "not found" });
    const session = registry.getConnected(sessionIdFromHeaders(request.headers));
    const uid = session?.tsSession?.selfUid;
    if (!uid) return reply.code(401).send({ error: "not connected" });
    const profile = store.remove(uid, asset);
    broadcast(profile);
    return profile;
  });
}
