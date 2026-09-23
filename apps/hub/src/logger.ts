import pino, { type Logger, type LoggerOptions } from "pino";
import type { Config } from "./config.js";

export type { Logger };

/** Query parameters that carry a session id or other bearer-ish secret. */
const SECRET_PARAMS = new Set(["session", "sessionid", "token"]);

/**
 * Request logs would otherwise record the session id a URL carries
 * (`/api/tts/speak?session=…`, `/api/ts/<id>/icon/…`), turning a log file into
 * a list of live credentials.
 */
export function redactUrl(url: string): string {
  const cut = url.indexOf("?");
  const path = redactPath(cut < 0 ? url : url.slice(0, cut));
  if (cut < 0) return path;
  const params = new URLSearchParams(url.slice(cut + 1));
  for (const key of [...params.keys()]) {
    if (SECRET_PARAMS.has(key.toLowerCase())) params.set(key, "***");
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * The bearer secrets a path can carry, each with what replaces it: the session
 * id (or asset token) in `/api/ts/<id>/icon/5`, the ticket of a one-use
 * download link, and the ticket of a media link. A media link is the one that
 * matters most: a `<video>` cannot send `x-session-id`, so its GET cannot ask
 * for one, and the link alone streams the file — as often as anyone likes, for
 * FT_MEDIA_TICKET_TTL_MS — while its owner stays online. Before it was listed
 * here every seek wrote a live link into the request log.
 */
const SECRET_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/api\/ts\/[^/?#\s"'`]+/g, "/api/ts/***"],
  [/\/api\/files\/download\/[^/?#\s"'`]+/g, "/api/files/download/***"],
  [/\/api\/files\/media\/[^/?#\s"'`]+/g, "/api/files/media/***"],
];

/** A secret query parameter inside free text (see SECRET_PARAMS). */
const SECRET_PARAM_TEXT = /([?&](?:session|sessionid|token)=)[^&#\s"'`]*/gi;

/** Replaces every secret a path may carry (SECRET_PATHS) with a placeholder. */
function redactPath(path: string): string {
  return SECRET_PATHS.reduce(
    (out, [pattern, placeholder]) => out.replace(pattern, placeholder),
    path,
  );
}

/**
 * The same redaction for free text. Not every line that names a URL goes
 * through the request serializer: Fastify logs its own 404 as the message
 * `Route GET:<url> not found`, and a reply sent twice as an error whose message
 * holds the URL. A link with an extra `/` on the end would otherwise reach the
 * log that way.
 */
export function redactText(text: string): string {
  return redactPath(text).replace(SECRET_PARAM_TEXT, "$1***");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pino hands us the raw request
function serializeRequest(request: any): Record<string, unknown> {
  return {
    method: request.method,
    url: typeof request.url === "string" ? redactUrl(request.url) : request.url,
    remoteAddress: request.ip ?? request.socket?.remoteAddress,
  };
}

/** pino's error serializer, with the message and stack redacted (see redactText). */
function serializeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { ...pino.stdSerializers.err(err) };
  for (const key of ["message", "stack"] as const) {
    const value = out[key];
    if (typeof value === "string") out[key] = redactText(value);
  }
  return out;
}

/**
 * What every hub logger is built with: the request and error serializers, and
 * a hook that redacts string arguments (the message itself), so a secret never
 * reaches the log whichever of the three a line carries it in.
 */
export function redactingLoggerOptions(): LoggerOptions {
  return {
    serializers: { req: serializeRequest, err: serializeError },
    hooks: {
      logMethod(args, method) {
        const redacted = args.map((arg: unknown) =>
          typeof arg === "string" ? redactText(arg) : arg,
        );
        return method.apply(this, redacted as Parameters<typeof method>);
      },
    },
  };
}

export function createLogger(config: Pick<Config, "HUB_LOG_LEVEL" | "HUB_LOG_PRETTY">): Logger {
  const options = { ...redactingLoggerOptions(), level: config.HUB_LOG_LEVEL };
  if (config.HUB_LOG_PRETTY) {
    return pino({
      ...options,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
    });
  }
  return pino(options);
}
