import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerEmptyBodyParser } from "./empty-body.js";

let app: FastifyInstance;

async function build(): Promise<FastifyInstance> {
  app = Fastify();
  registerEmptyBodyParser(app);
  app.post("/echo", async (request) => ({ body: request.body ?? null }));
  app.delete("/echo", async () => ({ ok: true }));
  await app.ready();
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe("registerEmptyBodyParser", () => {
  // A reverse proxy (Zoraxy, in production) forwards Chrome's body-less HTTP/2
  // POST as `transfer-encoding: chunked` with no content-type; stock Fastify
  // answers that with 415 Unsupported Media Type.
  it("accepts a chunked, empty POST that names no content type", async () => {
    await build();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "transfer-encoding": "chunked" },
      payload: "",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: null });
  });

  it("accepts a chunked, empty DELETE that names no content type", async () => {
    await build();
    const res = await app.inject({
      method: "DELETE",
      url: "/echo",
      headers: { "transfer-encoding": "chunked" },
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });

  it("still refuses a body that names no content type", async () => {
    await build();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "transfer-encoding": "chunked" },
      payload: "hello",
    });
    expect(res.statusCode).toBe(415);
  });

  it("still refuses a content type nobody parses", async () => {
    await build();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "text/xml" },
      payload: "<a/>",
    });
    expect(res.statusCode).toBe(415);
  });

  it("leaves JSON bodies alone", async () => {
    await build();
    const res = await app.inject({ method: "POST", url: "/echo", payload: { a: 1 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: { a: 1 } });
  });
});
