import { errorCodes, type FastifyInstance } from "fastify";

/** Anything bigger than this with no content type is not "an empty body". */
const MAX_UNTYPED_BYTES = 1024;

/**
 * Lets a body-less request through when it names no content type.
 *
 * Fastify only skips body parsing when a request carries neither
 * `transfer-encoding` nor a non-zero `content-length`. Behind a reverse proxy
 * (Zoraxy in production) Chrome's body-less HTTP/2 POST — next track, clear
 * queue — arrives as `transfer-encoding: chunked` with no content type, and
 * stock Fastify answers 415 Unsupported Media Type before any route runs.
 *
 * Fastify's `*` parser is also the fallback for content types nobody else
 * parses, so this refuses anything that names a type, or sends actual bytes,
 * exactly as Fastify would have.
 */
export function registerEmptyBodyParser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any logger/type-provider flavour
  app: FastifyInstance<any, any, any, any, any>,
): void {
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer", bodyLimit: MAX_UNTYPED_BYTES },
    (request, body, done) => {
      const untyped = request.headers["content-type"] === undefined;
      if (untyped && (body as Buffer).length === 0) {
        done(null, undefined);
        return;
      }
      done(new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE(), undefined);
    },
  );
}
