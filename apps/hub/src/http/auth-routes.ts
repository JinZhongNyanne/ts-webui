/**
 * The hub password gate (HUB_PASSWORD).
 *
 *   GET  /api/auth         -> { required, authenticated }
 *   POST /api/auth/login   { password } -> sets the pass cookie
 *   POST /api/auth/logout  -> clears it
 *
 * Every other `/api/*` route, and the websocket (see `hasHubPass`), needs the
 * cookie. Only `/api/health` and the three routes above stay open, so the page
 * can find out it has to ask for the password.
 */
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { HUB_AUTH_COOKIE, type HubAuth } from "../security/hub-auth.js";
import type { RateLimiter } from "../security/limits.js";
import type { Logger } from "../logger.js";

const LoginSchema = z.object({ password: z.string().max(200) });

/** Reachable without the cookie. */
const OPEN_PATHS = new Set(["/api/health", "/api/auth", "/api/auth/login", "/api/auth/logout"]);

export interface HubAuthRouteOptions {
  auth: HubAuth;
  /** Per-IP login attempts; the password is the only thing standing in the way. */
  loginLimiter: RateLimiter;
  logger: Logger;
}

export function hasHubPass(auth: HubAuth, request: FastifyRequest): boolean {
  return auth.verify(request.cookies[HUB_AUTH_COOKIE]);
}

export async function registerHubAuth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any logger/type-provider flavour
  app: FastifyInstance<any, any, any, any, any>,
  opts: HubAuthRouteOptions,
): Promise<void> {
  const { auth, loginLimiter, logger } = opts;
  await app.register(fastifyCookie);

  app.addHook("onRequest", async (request, reply) => {
    if (!auth.required) return;
    // The route Fastify matched, not the raw URL: the router decodes `%61pi`
    // to `api`, so a check on the raw string could be walked around.
    const route = request.routeOptions.url;
    if (!route?.startsWith("/api/") || OPEN_PATHS.has(route)) return;
    if (!hasHubPass(auth, request)) return reply.code(401).send({ error: "hub password required" });
  });

  app.get("/api/auth", async (request) => ({
    required: auth.required,
    authenticated: hasHubPass(auth, request),
  }));

  app.post("/api/auth/login", async (request, reply) => {
    if (!loginLimiter.take(request.ip)) {
      return reply.code(429).send({ error: "too many attempts" });
    }
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    if (!auth.required) return { ok: true };
    if (!auth.checkPassword(body.data.password)) {
      logger.warn({ ip: request.ip }, "wrong hub password");
      return reply.code(401).send({ error: "wrong password" });
    }
    const pass = auth.issue();
    setPassCookie(reply, pass.value, new Date(pass.expiresAt), isHttps(request));
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    setPassCookie(reply, "", new Date(0), isHttps(request));
    return { ok: true };
  });
}

/**
 * Whether the page lives on HTTPS, so the cookie can be Secure. `protocol`
 * needs the proxy to send X-Forwarded-Proto; the Origin of the login POST
 * (already checked against the allow list) says the same without it. A LAN
 * origin on plain http still gets a cookie the browser will keep.
 */
function isHttps(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  return request.protocol === "https" || (origin?.toLowerCase().startsWith("https:") ?? false);
}

function setPassCookie(reply: FastifyReply, value: string, expires: Date, secure: boolean): void {
  void reply.setCookie(HUB_AUTH_COOKIE, value, {
    path: "/",
    httpOnly: true,
    // Strict: no other site can ride the cookie into a websocket or a write.
    sameSite: "strict",
    secure,
    expires,
  });
}
