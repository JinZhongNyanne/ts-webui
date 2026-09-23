import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Runs `gone` once the browser's connection for this request has closed — at
 * once when it already has.
 *
 * A transfer route takes a slot and then listens for `close` to give it back.
 * But the socket can close while the async hooks before the handler still run
 * (the origin and rate checks, the gateway password), and a listener attached
 * after that never fires: the slot was then held for good, and the session
 * answered "busy" from then on. So the listener is attached and the connection
 * checked in one step. `gone` runs at most once.
 */
export function onGone(request: FastifyRequest, reply: FastifyReply, gone: () => void): void {
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    reply.raw.removeListener("close", once);
    gone();
  };
  reply.raw.once("close", once);
  if (request.raw.destroyed || reply.raw.destroyed) once();
}
