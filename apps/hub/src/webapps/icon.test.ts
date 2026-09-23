import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeDataIcon, fetchSiteIcon, findIconLinks, iconType } from "./icon.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0]);

describe("findIconLinks", () => {
  const base = new URL("https://site.example/app/");

  it("finds icon links in the head, best first, resolved against the page", () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/x.css">
      <link rel="icon" href="/small.png" sizes="16x16">
      <link href='big.png' rel='icon' sizes='192x192'>
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="shortcut icon" href="/favicon.ico?v=1&amp;x=2">
    </head><body><link rel="icon" href="/in-body.png"></body></html>`;
    expect(findIconLinks(html, base)).toEqual([
      "https://site.example/touch.png",
      "https://site.example/app/big.png",
      "https://site.example/small.png",
      "https://site.example/favicon.ico?v=1&x=2",
    ]);
  });

  it("drops scripts and other schemes", () => {
    const html = `<head><link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAAA"></head>`;
    expect(findIconLinks(html, base)).toEqual(["data:image/png;base64,AAAA"]);
  });
});

describe("iconType", () => {
  it("trusts a declared image type", () =>
    expect(iconType("image/png; x=1", PNG)).toBe("image/png"));
  it("recognises icons served as octet-stream by their bytes", () => {
    expect(iconType("application/octet-stream", ICO)).toBe("image/x-icon");
    expect(iconType("", PNG)).toBe("image/png");
  });
  it("refuses anything else", () =>
    expect(iconType("text/html", Buffer.from("<html>"))).toBeNull());
});

describe("decodeDataIcon", () => {
  it("decodes an inline base64 image", () =>
    expect(decodeDataIcon(`data:image/png;base64,${PNG.toString("base64")}`)).toEqual({
      contentType: "image/png",
      body: PNG,
    }));
  it("refuses non-images", () =>
    expect(decodeDataIcon("data:text/html;base64,PGh0bWw+")).toBeNull());
});

describe("fetchSiteIcon", () => {
  afterEach(() => vi.unstubAllGlobals());

  const publicHost = async () => ["203.0.113.7"];

  function respond(routes: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      const route = routes[url];
      return route ? route() : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("takes the page's declared icon", async () => {
    respond({
      "https://site.example/": () =>
        new Response(`<head><link rel="icon" href="/i.png"></head>`, {
          headers: { "content-type": "text/html" },
        }),
      "https://site.example/i.png": () =>
        new Response(PNG, { headers: { "content-type": "image/png" } }),
    });
    const icon = await fetchSiteIcon(new URL("https://site.example/"), { resolve: publicHost });
    expect(icon).toEqual({ contentType: "image/png", body: PNG });
  });

  it("falls back to /favicon.ico after a redirect", async () => {
    respond({
      "https://site.example/": () =>
        new Response("", { status: 301, headers: { location: "https://www.site.example/home" } }),
      "https://www.site.example/home": () =>
        new Response("<head></head>", { headers: { "content-type": "text/html" } }),
      "https://www.site.example/favicon.ico": () =>
        new Response(ICO, { headers: { "content-type": "application/octet-stream" } }),
    });
    const icon = await fetchSiteIcon(new URL("https://site.example/"), { resolve: publicHost });
    expect(icon?.contentType).toBe("image/x-icon");
  });

  it("never fetches from a private address", async () => {
    const fetchMock = respond({});
    const icon = await fetchSiteIcon(new URL("http://nas.lan/"), {
      resolve: async () => ["192.168.1.10"],
    });
    expect(icon).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect into a private range", async () => {
    const fetchMock = respond({
      "https://site.example/": () =>
        new Response("", { status: 302, headers: { location: "http://metadata.internal/" } }),
    });
    const icon = await fetchSiteIcon(new URL("https://site.example/"), {
      resolve: async (host) =>
        host === "metadata.internal" ? ["169.254.169.254"] : ["203.0.113.7"],
    });
    expect(icon).toBeNull();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("metadata.internal"))).toBe(false);
  });

  it("ignores a page that is not an image where an icon should be", async () => {
    respond({
      "https://site.example/": () =>
        new Response(`<head><link rel="icon" href="/i.png"></head>`, {
          headers: { "content-type": "text/html" },
        }),
      "https://site.example/i.png": () =>
        new Response("<html>nope</html>", { headers: { "content-type": "text/html" } }),
    });
    expect(
      await fetchSiteIcon(new URL("https://site.example/"), { resolve: publicHost }),
    ).toBeNull();
  });
});
