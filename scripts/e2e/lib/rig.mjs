/**
 * The multi-client test rig: a prepared TeamSpeak server, a hub + vite, and
 * any number of browser clients connected through them.
 *
 * Everything the rig creates carries this run's id (`e2e-<id>`), so several
 * runs — and other people's clients — can share one test server, and so
 * `cleanup()` removes exactly what this run added: its channels, its
 * privilege key, the database entries of its web identities, and the
 * processes it spawned. Nothing server-wide (passwords, settings) is touched.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ServerQuery } from "./serverquery.mjs";
import { startHub, startWeb, stopAndClean, waitForHttp } from "./processes.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The regular (type 1) "Server Admin" group; templates are type 0, query groups type 2. */
const REGULAR_GROUP = "1";

/** What every privilege key a run makes says first (`e2e-<runId> …`). */
const RIG_KEY_PREFIX = "e2e-";
/**
 * How old a rig key must be before a new run counts it as left over. Several
 * runs may share a server, and a key younger than this may belong to one that
 * is still going (a whole suite takes well under this).
 */
const STALE_KEY_AGE_S = 2 * 60 * 60;
/** ServerQuery's "database empty result set": a list with nothing in it. */
const EMPTY_RESULT = 1281;

/** Polls `fn` until it returns something truthy; throws `what` on timeout. */
export async function until(fn, what, timeoutMs = 30_000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(stepMs);
  }
  throw new Error(
    `timed out after ${timeoutMs / 1000}s: ${what}${lastErr ? ` (${lastErr.message})` : ""}`,
  );
}

/** A window's button on the desktop taskbar. */
const taskbarButton = (page, panelId) =>
  page.locator(`[data-testid=taskbar-button][data-panel="${panelId}"]`).first();

/** Whether the taskbar shows that button's window as minimised. */
const isMinimised = (button) => button.evaluate((el) => el.classList.contains("minimized"));

/**
 * Whether something else lies over the middle of a desktop icon, so that a
 * click there would not reach it.
 */
function iconIsCovered(icon) {
  return icon.evaluate((el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return true;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !hit || !el.contains(hit);
  });
}

/**
 * Presses the taskbar's "minimise all" and answers the windows it put away
 * (the ones showing before), for the caller to bring back. A page without the
 * button (the phone shell) has nothing to clear.
 */
async function minimiseShowing(page) {
  const minimiseAll = page.getByTestId("taskbar-minimize-all");
  if ((await minimiseAll.count()) === 0) return [];
  const buttons = page.locator("[data-testid=taskbar-button]");
  const showing = await buttons.evaluateAll((els) =>
    els.filter((el) => !el.classList.contains("minimized")).map((el) => el.dataset.panel ?? ""),
  );
  if (showing.length === 0) return [];
  await minimiseAll.click();
  await until(
    () => buttons.evaluateAll((els) => els.every((el) => el.classList.contains("minimized"))),
    "every window is minimised",
    5_000,
  );
  return showing.filter(Boolean);
}

export class Rig {
  /** @param {import("./config.mjs").RigConfig} config */
  constructor(config) {
    this.config = config;
    this.runId = config.runId;
    /** Prefix of every nickname and channel this run creates. */
    this.prefix = `e2e-${config.runId}`;
    this.webUrl = config.webUrl;
    this.hubUrl = config.hubUrl;
    this.sq = null;
    this.browser = null;
    /** `{ root, a, b }` channel ids, and `rootName` / `path(sub)` for connect profiles. */
    this.channels = null;
    this.privilegeKey = null;
    this.adminGroupId = null;
    this.clients = [];
    /** Database ids of every identity a client of ours used; deleted on cleanup. */
    this.dbIds = new Set();
    this.spawned = [];
    this.cleanups = [];
  }

  log(...args) {
    if (!this.config.quiet) console.log("  ·", ...args);
  }

  /* ------------------------------------------------------------- setup */

  async setup() {
    mkdirSync(this.config.artifacts, { recursive: true });
    await this.#startServers();
    this.sq = await ServerQuery.connect({
      host: this.config.queryHost,
      port: this.config.queryPort,
      user: this.config.queryUser,
      password: this.config.queryPassword,
      sid: this.config.sid,
      nickname: `${this.prefix}-rig`,
    });
    await this.#dropStaleKeys();
    await this.#createChannels();
    await this.#createPrivilegeKey();
    this.browser = await chromium.launch({
      headless: !this.config.headed,
      // Playwright's own signal handlers close the browser and exit the
      // process, which would cut our cleanup (channels, hub, vite) short.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: [
        "--use-fake-ui-for-media-stream", // grant the microphone without a prompt
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  }

  async #startServers() {
    const logDir = this.config.artifacts;
    if (!this.config.reuseHub) {
      this.log(`starting hub on ${this.hubUrl}`);
      this.spawned.push(
        await startHub({
          root: this.config.root,
          port: this.config.hubPort,
          webOrigin: this.webUrl,
          logDir,
        }),
      );
    } else {
      await waitForHttp(`${this.hubUrl}/api/health`, 5_000);
      this.log(`reusing hub at ${this.hubUrl}`);
    }
    if (!this.config.reuseWeb) {
      this.log(`starting vite on ${this.webUrl}`);
      this.spawned.push(
        await startWeb({
          root: this.config.root,
          port: this.config.webPort,
          hubUrl: this.hubUrl,
          logDir,
        }),
      );
    } else {
      await waitForHttp(this.webUrl, 5_000);
      this.log(`reusing web at ${this.webUrl}`);
    }
  }

  /**
   * A small tree: `e2e-<id>` with two sub-channels. Semi-permanent, so it
   * survives being empty (a temporary channel made over ServerQuery could
   * vanish before the first client arrives) and still goes away on a server
   * restart if cleanup never ran.
   */
  async #createChannels() {
    const make = async (name, cpid) => {
      const [rec] = await this.sq.cmd("channelcreate", {
        channel_name: name,
        cpid,
        channel_flag_semi_permanent: 1,
        channel_description: `e2e rig run ${this.runId}; safe to delete`,
      });
      return rec.cid;
    };
    const rootName = this.prefix;
    const root = await make(rootName, 0);
    // Registered right away: a failure creating a child must still remove the root.
    this.cleanups.push(() => this.sq.cmd("channeldelete", { cid: root, force: 1 }));
    const a = await make(`${rootName}-a`, root);
    const b = await make(`${rootName}-b`, root);
    this.channels = {
      root,
      a,
      b,
      rootName,
      /** TeamSpeak's "default channel" path for a sub-channel, e.g. `e2e-x/e2e-x-a`. */
      path: (sub) => (sub ? `${rootName}/${rootName}-${sub}` : rootName),
      name: (sub) => (sub ? `${rootName}-${sub}` : rootName),
    };
    this.log(`channels ${rootName} (${root}) › -a (${a}), -b (${b})`);
  }

  /**
   * Deletes privilege keys that earlier runs made and never cleaned up — a run
   * killed with `kill -9`, or cut off before its cleanup — so interrupted runs
   * cannot pile them up on the server. Only keys whose description starts
   * with the rig's own `e2e-` and that are older than STALE_KEY_AGE_S: never a
   * key of anyone else's, and never one a run still going may yet redeem.
   * Best effort: a server that will not list or delete them does not stop
   * this run.
   */
  async #dropStaleKeys() {
    let keys;
    try {
      keys = await this.sq.cmd("privilegekeylist");
    } catch (err) {
      if (err.id !== EMPTY_RESULT) this.log(`could not list privilege keys: ${err.message}`);
      return;
    }
    const cutoff = Math.floor(Date.now() / 1000) - STALE_KEY_AGE_S;
    const stale = keys.filter(
      (k) =>
        (k.token_description ?? "").startsWith(RIG_KEY_PREFIX) &&
        Number(k.token_created) > 0 &&
        Number(k.token_created) < cutoff,
    );
    for (const key of stale) {
      await this.sq
        .cmd("privilegekeydelete", { token: key.token })
        .then(() => this.log(`deleted a left-over key: ${key.token_description}`))
        .catch((err) =>
          this.log(`could not delete key "${key.token_description}": ${err.message}`),
        );
    }
  }

  /** A one-shot key for the Server Admin group, for specs that test redeeming it. */
  async #createPrivilegeKey() {
    const groups = await this.sq.cmd("servergrouplist");
    const admin = groups.find((g) => g.type === REGULAR_GROUP && g.name === "Server Admin");
    if (!admin) throw new Error('the server has no regular "Server Admin" group');
    this.adminGroupId = admin.sgid;
    const [rec] = await this.sq.cmd("privilegekeyadd", {
      tokentype: 0,
      tokenid1: admin.sgid,
      tokenid2: 0,
      tokendescription: `${this.prefix} rig`,
    });
    this.privilegeKey = rec.token;
    this.cleanups.push(async () => {
      // A redeemed key is already gone; that is not a cleanup failure.
      await this.sq.cmd("privilegekeydelete", { token: rec.token }).catch(() => undefined);
    });
  }

  /* ----------------------------------------------------------- clients */

  /**
   * Opens a fresh browser context (so a fresh identity) and connects it as
   * `nick` (prefixed with this run's id unless it already is). Resolves once
   * the client is in the channel tree of its own page.
   */
  async connect(nick, { channel = "a", viewport, admin = false } = {}) {
    const nickname = nick.startsWith(this.prefix) ? nick : `${this.prefix}-${nick}`;
    const context = await this.browser.newContext({
      locale: "en-US",
      viewport: viewport ?? { width: 1400, height: 900 },
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    const client = { nick: nickname, context, page, clid: null, dbId: null, admin: false };
    this.clients.push(client);
    page.on("pageerror", (e) => this.log(`[${nickname}] page error: ${e.message.slice(0, 200)}`));

    const [host, port] = [this.config.tsHost, this.config.tsPort];
    // Seed the saved connect profile rather than typing into the form: the
    // dialog's layout changes (bookmarks, identities), the profile shape less so.
    await page.addInitScript(
      ({ profile }) => {
        // Init scripts also run in iframes (the Apps panel's sites).
        if (window !== window.top) return;
        const saved = localStorage.getItem("jinz.ts.profile");
        // The app no longer keeps the server password in the saved profile,
        // so a spec that reloads needs it put back every time.
        const next = saved
          ? { ...JSON.parse(saved), serverPassword: profile.serverPassword }
          : profile;
        localStorage.setItem("jinz.ts.profile", JSON.stringify(next));
      },
      {
        profile: {
          host,
          port,
          nickname,
          serverPassword: this.config.tsPassword,
          defaultChannel: channel ? this.channels.path(channel) : "",
          // Blank: the hub tries the TeamSpeak host's :3000 and, finding no
          // bot there, the panel just says so (a named one would show an error).
          musicBot: "",
        },
      },
    );
    await page.goto(this.webUrl, { waitUntil: "domcontentloaded" });
    await page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
    await until(
      () => page.evaluate(() => window.__jinzTs?.self?.() ?? null),
      `${nickname} connects (is vite serving a dev build?)`,
      45_000,
    );
    await this.waitForClientInTree(page, nickname);

    // The database id is what group assignments and cleanup need. Look the
    // client up by the id the page itself was given, and by nothing else. A
    // spec that just finished leaves its own "alice" on the server until it
    // times out: a nickname lookup would hand this spec that ghost's id, which
    // turns invalid mid-spec (ServerQuery error 512) once the ghost goes, and
    // while the ghost holds the name the server gives this client a variant of
    // it, so the nickname cannot be required to match either.
    const ownId = await page.evaluate(() => window.__jinzTs?.self?.()?.id ?? null);
    if (ownId === null) throw new Error(`${nickname} connected but the page reports no client id`);
    const rec = await until(
      async () => (await this.sq.cmd("clientlist")).find((c) => String(c.clid) === String(ownId)),
      `${nickname} (clid ${ownId}) shows up in ServerQuery's clientlist`,
    );
    client.clid = rec.clid;
    client.dbId = rec.client_database_id;
    this.dbIds.add(rec.client_database_id);
    this.log(`connected ${nickname} (clid ${rec.clid}, dbid ${rec.client_database_id})`);
    if (admin) await this.makeAdmin(client);
    return client;
  }

  /**
   * Puts the client into Server Admin. The web UI can redeem a privilege key
   * (`privilegekeyuse`; m4-server-admin.spec.mjs does, with a key of its own),
   * but most specs only need the group, so it is applied through ServerQuery
   * by database id — faster, and the effect on the client is the same.
   */
  async makeAdmin(client) {
    await this.sq.cmd("servergroupaddclient", { sgid: this.adminGroupId, cldbid: client.dbId });
    client.admin = true;
    await until(
      () =>
        client.page.evaluate(
          (sgid) => window.__jinzTs?.self?.()?.serverGroups?.includes(sgid) ?? false,
          this.adminGroupId,
        ),
      `${client.nick} sees itself in Server Admin`,
      15_000,
    );
    this.log(`${client.nick} is now Server Admin`);
  }

  /** Waits until `nick` is listed in the channel tree rendered on `page`. */
  async waitForClientInTree(page, nick, timeoutMs = 20_000) {
    const row = page
      .locator(".tree .client .nick")
      .filter({ hasText: new RegExp(`^\\s*${escapeRe(nick)}\\s*$`) });
    await row.first().waitFor({ state: "visible", timeout: timeoutMs });
    return row.first();
  }

  /** Runs one raw ServerQuery command line and returns its records. */
  serverQuery(line) {
    return this.sq.send(line);
  }

  /* -------------------------------------------------------------- chat */

  /**
   * Brings a chat window to the front from its taskbar button.
   *
   * On the desktop shell a taskbar click on the window that is *already* in
   * front minimises it, the way Windows does, so the click only happens when
   * this chat is not already the window in front (`aria-pressed`).
   */
  async openChat(page, title) {
    const button = page.locator("[data-testid=taskbar-button]").filter({ hasText: title }).first();
    await button.waitFor({ state: "visible", timeout: 15_000 });
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    const panel = page
      .locator("section.chat")
      .filter({ has: page.locator(".title", { hasText: title }) });
    await panel.first().waitFor({ state: "visible", timeout: 10_000 });
    return panel.first();
  }

  /**
   * Opens a window from its desktop icon, the way a user does, and leaves it
   * in front.
   *
   * The starter desktop tiles the whole screen, so the icons usually lie
   * under a window and a click on one lands on that window instead. A user
   * clears the desktop first, and so does this: "minimise all" on the
   * taskbar, the click, then every window that was showing is restored from
   * its taskbar button (which leaves it exactly where it was) and the new one
   * is brought back to the front. The minimise-all button itself cannot put
   * them back: by then the new window is showing, so a second press would
   * minimise that too. When nothing covers the icon, it is just clicked.
   */
  async openFromDesktop(page, windowId) {
    const icon = page.locator(`[data-testid=desktop-icon][data-window=${windowId}]`);
    await icon.waitFor({ state: "attached", timeout: 15_000 });
    const cleared = (await iconIsCovered(icon)) ? await minimiseShowing(page) : [];
    await icon.waitFor({ state: "visible", timeout: 15_000 });
    // One click opens a desktop icon; there is no select-then-open step.
    await icon.click();
    const opened = taskbarButton(page, windowId);
    await opened.waitFor({ state: "visible", timeout: 15_000 });
    if (cleared.length === 0) return;
    for (const panelId of cleared) {
      if (panelId === windowId) continue;
      const button = taskbarButton(page, panelId);
      // A window that closed meanwhile has no button left to restore it from.
      if ((await button.count()) === 0) continue;
      await button.click();
      await until(async () => !(await isMinimised(button)), `window ${panelId} is restored`, 5_000);
    }
    // Restoring raised each of those in turn; the one just opened goes on top.
    if ((await opened.getAttribute("aria-pressed")) !== "true") await opened.click();
    await until(
      async () => (await opened.getAttribute("aria-pressed")) === "true",
      `window ${windowId} is in front`,
      5_000,
    );
  }

  /** Sends `text` to the chat of the channel the client sits in. */
  async sendChannelMessage(client, text, channelName) {
    const panel = await this.openChat(client.page, channelName);
    await panel.locator(".composer input").fill(text);
    await panel.locator(".composer input").press("Enter");
  }

  /** Waits for a chat line with `text` (optionally from `from`) in that channel's panel. */
  async waitForChatMessage(client, text, channelName, from) {
    const panel = await this.openChat(client.page, channelName);
    let line = panel
      .locator(".msg")
      .filter({ has: client.page.locator(".text", { hasText: text }) });
    if (from) line = line.filter({ has: client.page.locator(".from", { hasText: from }) });
    await line.first().waitFor({ state: "visible", timeout: 15_000 });
    return line.first();
  }

  /** A path under this run's artifacts folder, for a spec's own screenshots. */
  artifact(name) {
    return path.join(this.config.artifacts, name);
  }

  /** Saves a screenshot of every open client under the artifacts folder. */
  async screenshotAll(label) {
    for (const c of this.clients) {
      const file = this.artifact(`${label}-${c.nick}.png`);
      await c.page.screenshot({ path: file }).catch(() => undefined);
    }
  }

  /** Closes every client (spec teardown); the server fixtures stay for the next spec. */
  async closeClients() {
    const open = this.clients;
    this.clients = [];
    await Promise.all(open.map((c) => c.context.close().catch(() => undefined)));
  }

  /* ----------------------------------------------------------- cleanup */

  /**
   * Undoes everything, best effort: each step runs even when an earlier one
   * failed, and the failures are reported together at the end.
   */
  async cleanup() {
    const problems = [];
    const attempt = async (what, fn) => {
      try {
        await fn();
      } catch (err) {
        problems.push(`${what}: ${err.message}`);
      }
    };
    await attempt("closing clients", () => this.closeClients());
    await attempt("closing the browser", () => this.browser?.close());
    if (this.sq) {
      // The identities' database entries only go away once they are offline.
      if (this.dbIds.size) await sleep(1_000);
      for (const dbId of this.dbIds) {
        await attempt(`deleting client db entry ${dbId}`, async () => {
          const online = (await this.sq.cmd("clientlist")).find(
            (c) => c.client_database_id === dbId,
          );
          if (online)
            await this.sq.cmd("clientkick", {
              clid: online.clid,
              reasonid: 5,
              reasonmsg: "e2e cleanup",
            });
          await this.sq.cmd("clientdbdelete", { cldbid: dbId });
        });
      }
      for (const fn of [...this.cleanups].reverse()) await attempt("server fixture", fn);
      this.sq.close();
    }
    for (const child of this.spawned.reverse())
      await attempt(`stopping ${child.label}`, () => stopAndClean(child));
    this.spawned = [];
    return problems;
  }
}
