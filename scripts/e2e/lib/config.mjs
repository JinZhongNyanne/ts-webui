/**
 * Command-line flags and environment for the e2e rig. Flags win over the
 * environment, which wins over the defaults.
 *
 * @typedef {ReturnType<typeof parseConfig>} RigConfig
 */
import os from "node:os";
import path from "node:path";

export const USAGE = `usage: npm run e2e -- [spec-filter…] [options]

  spec-filter            run only specs whose file name contains one of these

  --headed               show the browsers
  --keep-open            leave everything running after the specs (Ctrl+C cleans up)
  --hub-url URL          reuse a running hub instead of starting one on --hub-port
  --web-url URL          reuse a running vite (dev build) instead of starting one
  --hub-port N           port for the hub the rig starts      (default 8102)
  --web-port N           port for the vite the rig starts     (default 5302)
  --ts HOST[:PORT]       TeamSpeak server for the clients     (default localhost:9987)
  --ts-password PW       its server password, if any          (env E2E_TS_PASSWORD)
  --query HOST[:PORT]    its ServerQuery                      (default 127.0.0.1:10011)
  --query-user NAME      ServerQuery login                    (default serveradmin)
  --query-password PW    ServerQuery password  (required;     env E2E_QUERY_PASSWORD)
  --sid N                virtual server id                    (default 1)
  --artifacts DIR        logs and screenshots                 (default $TMPDIR/jinz-e2e-<run>)
`;

function hostPort(value, defaultPort) {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(value);
  if (!m) throw new Error(`bad address "${value}"`);
  return [m[1], Number(m[2] ?? defaultPort)];
}

export function parseConfig(argv, env, root) {
  const flags = new Map();
  const bools = new Set(["headed", "keep-open", "help", "quiet"]);
  const filters = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      filters.push(a);
      continue;
    }
    const name = a.slice(2);
    if (bools.has(name)) flags.set(name, true);
    else if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
    else flags.set(name, argv[++i]);
  }
  const get = (name, envName, fallback) => flags.get(name) ?? (envName && env[envName]) ?? fallback;

  // Short and sortable, and it keeps nicknames well under TeamSpeak's 30 characters.
  const runId = (
    Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4)
  ).toLowerCase();
  const hubPort = Number(get("hub-port", "E2E_HUB_PORT", 8102));
  const webPort = Number(get("web-port", "E2E_WEB_PORT", 5302));
  const hubUrlFlag = get("hub-url", "E2E_HUB_URL", "");
  const webUrlFlag = get("web-url", "E2E_WEB_URL", "");
  const [tsHost, tsPort] = hostPort(get("ts", "E2E_TS", "localhost:9987"), 9987);
  const [queryHost, queryPort] = hostPort(get("query", "E2E_QUERY", "127.0.0.1:10011"), 10011);

  return {
    root,
    runId,
    filters,
    help: flags.has("help"),
    headed: flags.has("headed"),
    keepOpen: flags.has("keep-open"),
    quiet: flags.has("quiet"),
    hubPort,
    webPort,
    reuseHub: !!hubUrlFlag,
    reuseWeb: !!webUrlFlag,
    hubUrl: (hubUrlFlag || `http://127.0.0.1:${hubPort}`).replace(/\/+$/, ""),
    webUrl: (webUrlFlag || `http://127.0.0.1:${webPort}`).replace(/\/+$/, ""),
    tsHost,
    tsPort,
    tsPassword: get("ts-password", "E2E_TS_PASSWORD", ""),
    queryHost,
    queryPort,
    queryUser: get("query-user", "E2E_QUERY_USER", "serveradmin"),
    queryPassword: get("query-password", "E2E_QUERY_PASSWORD", ""),
    sid: Number(get("sid", "E2E_SID", 1)),
    artifacts: path.resolve(
      get("artifacts", "E2E_ARTIFACTS", path.join(os.tmpdir(), `jinz-e2e-${runId}`)),
    ),
  };
}
