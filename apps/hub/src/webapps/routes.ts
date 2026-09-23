import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_APP_NAME_LENGTH, normalizeAppUrl, type SharedApp } from "@jinz/protocol";
import type { Session } from "../session/Session.js";
import { sessionIdFromHeaders, type AssetRegistry } from "../session/asset-registry.js";
import type { RateLimiter } from "../security/limits.js";
import type { Logger } from "../logger.js";
import type { AppStore } from "./store.js";
import type { SiteIcon } from "./icon.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any fastify type-provider flavour
type AnyFastify = FastifyInstance<any, any, any, any, any>;

export interface AppRegistry extends AssetRegistry {
  values(): Iterable<Session>;
}

export interface AppRouteDeps {
  store: AppStore;
  registry: AppRegistry;
  logger: Logger;
  /** Origins the web UI is served from; a site there may not be framed. */
  ownOrigins: readonly string[];
  /** Budget for adding and removing, per session. */
  limiter?: RateLimiter;
  /** Finds a site's icon; swapped in tests. */
  fetchIcon: (site: URL) => Promise<SiteIcon | null>;
}

const AddBody = z.object({
  name: z
    .string()
    .max(MAX_APP_NAME_LENGTH * 4)
    .default(""),
  url: z.string().min(1).max(2048),
});

/**
 * The Apps window's list, shared by everyone on the hub.
 *
 * Any connected user may add or remove a site (a hub is a group of people who
 * know each other, and the list is theirs); every change is pushed to every
 * connected session as `apps.updated`. The icon is fetched after the site is
 * added and arrives as a second update, so adding never waits on a slow site.
 * Icons are served from the hub's origin, since the app's CSP allows no other
 * image source; like profile assets, their URL carries an asset token.
 */
export function registerAppRoutes(app: AnyFastify, deps: AppRouteDeps): void {
  const { store, registry } = deps;

  function broadcast(): void {
    const msg = { type: "apps.updated" as const, apps: store.list() };
    for (const session of registry.values()) {
      if (registry.getConnected(session.id)) session.send(msg);
    }
  }

  async function loadIcon(site: SharedApp): Promise<void> {
    try {
      const icon = await deps.fetchIcon(new URL(site.url));
      if (!icon) return;
      if (store.setIcon(site.id, icon.body, icon.contentType)) broadcast();
    } catch (err) {
      deps.logger.warn({ err, url: site.url }, "app icon fetch failed");
    }
  }

  /** The page's own origin as this request reached the hub, besides the configured ones. */
  function ownOrigins(request: FastifyRequest): string[] {
    const origins = [...deps.ownOrigins];
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin) origins.push(origin);
    origins.push(`${request.protocol}://${request.host}`);
    return origins;
  }

  app.get("/api/apps", async (request, reply) => {
    if (!registry.getConnected(sessionIdFromHeaders(request.headers))) {
      return reply.code(401).send({ error: "not connected" });
    }
    return { apps: store.list() };
  });

  app.post("/api/apps", async (request, reply) => {
    const session = registry.getConnected(sessionIdFromHeaders(request.headers));
    if (!session) return reply.code(401).send({ error: "not connected" });
    if (deps.limiter && !deps.limiter.take(session.id)) {
      return reply.code(429).send({ error: "too many requests" });
    }
    const body = AddBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid" });
    const checked = normalizeAppUrl(body.data.url, ownOrigins(request));
    if ("error" in checked) return reply.code(400).send({ error: checked.error });

    const result = store.add(body.data.name, checked.url, session.tsSession?.selfNickname ?? "");
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    broadcast();
    void loadIcon(result.app);
    return reply.code(201).send({ app: result.app });
  });

  app.delete<{ Params: { id: string } }>("/api/apps/:id", async (request, reply) => {
    const session = registry.getConnected(sessionIdFromHeaders(request.headers));
    if (!session) return reply.code(401).send({ error: "not connected" });
    if (deps.limiter && !deps.limiter.take(session.id)) {
      return reply.code(429).send({ error: "too many requests" });
    }
    if (!store.remove(request.params.id)) return reply.code(404).send({ error: "not found" });
    broadcast();
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/api/app-icon/:id",
    async (request, reply) => {
      // An `<img>` cannot send a header; an unknown token looks like a missing icon.
      if (!registry.getConnectedByAssetToken(request.query.token)) return reply.code(404).send();
      const icon = store.readIcon(request.params.id);
      if (!icon) return reply.code(404).send();
      return (
        reply
          .header("content-type", icon.contentType)
          // The URL carries the icon's revision, so a hit may be kept for a week.
          .header("cache-control", "private, max-age=604800")
          .send(icon.body)
      );
    },
  );
}
