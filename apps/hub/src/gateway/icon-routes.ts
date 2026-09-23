import type { FastifyInstance } from "fastify";
import type { AssetRegistry } from "../session/asset-registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

/** Sniffs a common image content type from the leading bytes. */
function imageType(buf: Buffer): string {
  if (buf.length >= 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
    if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
    if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  }
  return "application/octet-stream";
}

/** Avatar hashes go into a file-store path, so keep them to safe characters. */
const AVATAR_HASH = /^[A-Za-z0-9+/=_-]{1,128}$/;

/**
 * Serves TeamSpeak icons and avatars downloaded (and cached) from the server's
 * internal file store, so the browser can render them like a native client.
 *
 * These URLs end up in `<img>` tags, so instead of the session id they carry a
 * short-lived asset token; a leaked image URL is then not a leaked session.
 * An unknown token answers 404 like a missing icon, giving a guesser nothing.
 */
export function registerIconRoutes(app: AnyFastify, registry: AssetRegistry): void {
  app.get<{ Params: { token: string; iconId: string } }>(
    "/api/ts/:token/icon/:iconId",
    async (request, reply) => {
      const session = registry.getConnectedByAssetToken(request.params.token);
      const ts = session?.tsSession;
      const iconId = Number(request.params.iconId);
      if (!ts || !Number.isFinite(iconId)) return reply.code(404).send();
      const buf = await ts.fetchIcon(iconId);
      if (!buf || buf.length === 0) return reply.code(404).send();
      return reply
        .header("content-type", imageType(buf))
        .header("cache-control", "private, max-age=86400")
        .send(buf);
    },
  );

  app.get<{ Params: { token: string; hash: string } }>(
    "/api/ts/:token/avatar/:hash",
    async (request, reply) => {
      const session = registry.getConnectedByAssetToken(request.params.token);
      const ts = session?.tsSession;
      const hash = request.params.hash;
      if (!ts || !AVATAR_HASH.test(hash)) return reply.code(404).send();
      const buf = await ts.fetchAvatar(hash);
      if (!buf || buf.length === 0) return reply.code(404).send();
      return reply
        .header("content-type", imageType(buf))
        .header("cache-control", "private, max-age=3600")
        .send(buf);
    },
  );
}
