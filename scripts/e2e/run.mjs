#!/usr/bin/env node
/**
 * Entry point of the e2e rig: `npm run e2e` (see scripts/e2e/README.md).
 *
 * Sets up one rig (servers, channels, privilege key), then runs every spec in
 * `specs/` in turn. Each spec gets fresh browser clients and closes them when
 * it ends; the rig is torn down once at the end, also on failure or Ctrl+C.
 *
 * Specs are plain modules, so no test framework is needed:
 *
 *   export const title = "what this checks";
 *   export default async function (rig) { … throw to fail … }
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseConfig, USAGE } from "./lib/config.mjs";
import { Rig } from "./lib/rig.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

let config;
try {
  config = parseConfig(process.argv.slice(2), process.env, root);
} catch (err) {
  console.error(`${err.message}\n\n${USAGE}`);
  process.exit(2);
}
if (config.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!config.queryPassword) {
  console.error(
    "The rig needs the ServerQuery password of the test server: set E2E_QUERY_PASSWORD or pass --query-password.\n" +
      "(For the dev docker server it is printed once in `docker logs <container>` on first start.)",
  );
  process.exit(2);
}

const specDir = path.join(here, "specs");
const specs = readdirSync(specDir)
  .filter((f) => f.endsWith(".spec.mjs"))
  .filter((f) => !config.filters.length || config.filters.some((q) => f.includes(q)))
  .sort();
if (!specs.length) {
  console.error(`no spec matches ${config.filters.join(", ")}`);
  process.exit(2);
}

const rig = new Rig(config);
let cleaning = null;
const cleanup = () => (cleaning ??= rig.cleanup());

// Ctrl+C mid-run must still remove the channels and stop the servers.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    console.log(`\n${sig}: cleaning up…`);
    const problems = await cleanup();
    for (const p of problems) console.error(`cleanup: ${p}`);
    process.exit(130);
  });
}

const results = [];
console.log(`e2e run ${config.runId} — artifacts in ${config.artifacts}\n`);
try {
  await rig.setup();
  for (const file of specs) {
    const mod = await import(pathToFileURL(path.join(specDir, file)).href);
    const title = mod.title ?? file;
    console.log(`▶ ${title}`);
    const started = Date.now();
    try {
      await mod.default(rig);
      results.push({ file, title, ok: true, ms: Date.now() - started });
      console.log(`✔ ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
    } catch (err) {
      results.push({ file, title, ok: false, err });
      console.log(`✘ ${title}\n  ${err.stack ?? err}\n`);
      await rig.screenshotAll(`fail-${path.basename(file, ".spec.mjs")}`);
    } finally {
      if (!config.keepOpen) await rig.closeClients();
    }
  }
} catch (err) {
  console.error(`rig setup failed: ${err.stack ?? err}`);
  results.push({ file: "(setup)", title: "rig setup", ok: false, err });
}

if (config.keepOpen) {
  console.log("--keep-open: everything stays up; press Ctrl+C to clean up.");
  await new Promise(() => undefined);
}

const problems = await cleanup();
for (const p of problems) console.error(`cleanup: ${p}`);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) console.log(`logs and screenshots: ${config.artifacts}`);
process.exit(failed.length || problems.length ? 1 : 0);
