/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { buildIdOf, stampServiceWorker } from "./src/pwa/swBuildId";

const hub = process.env.VITE_HUB_URL ?? "http://localhost:8080";

/** Where `public/sw.js` lands in the build output. */
const SERVICE_WORKER_FILE = "sw.js";

/**
 * Stamps the build id into the copied service worker, so that each deploy's
 * worker names its cache after its own build and deletes the previous one's
 * (see src/pwa/swBuildId.ts for why stamping rather than a query string).
 * `writeBundle` because Vite copies `public/` into the output only as the
 * bundle is rendered; by now the copy is on disk and every file name is known.
 */
function stampServiceWorkerBuildId(): Plugin {
  return {
    name: "jinz:sw-build-id",
    apply: "build",
    async writeBundle(options, bundle) {
      if (!options.dir) throw new Error("[sw] no output directory to find sw.js in");
      const file = join(options.dir, SERVICE_WORKER_FILE);
      const buildId = buildIdOf(Object.keys(bundle), (input) =>
        createHash("sha256").update(input).digest("hex"),
      );
      await writeFile(file, stampServiceWorker(await readFile(file, "utf8"), buildId));
    },
  };
}

export default defineConfig({
  plugins: [vue(), stampServiceWorkerBuildId()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: hub, changeOrigin: true },
      "/ws": { target: hub, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
