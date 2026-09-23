/**
 * M3 file browser commands against a real TeamSpeak server, through a hub's
 * `ts.cmd`: `ftcreatedir`, `ftrenamefile`, `ftdeletefile` (as a Server Admin
 * and as a guest), what they answer, and what the server tells the other
 * clients (every received command is traced in the hub's `log` messages).
 *
 *   node scripts/verify-m3-file-browser.mjs --hub http://127.0.0.1:8123 \
 *     --query-password '<serveradmin password>'
 *
 * Options: --ts host:port (localhost:9987), --query host:port (127.0.0.1:10011).
 * Makes two throwaway channels (one with a password) and deletes them, with
 * their files, at the end; the two identities go too.
 */
import WebSocket from "ws";
import { ServerQuery } from "./e2e/lib/serverquery.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const HUB = argOf("hub", "http://127.0.0.1:8123").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const [Q_HOST, Q_PORT = "10011"] = argOf("query", "127.0.0.1:10011").split(":");
const Q_PASSWORD = argOf("query-password", process.env.E2E_QUERY_PASSWORD ?? "");
const ORIGIN = argOf("origin", HUB);
const RUN = `m3fb-${Date.now().toString(36).slice(-5)}`;
const CHANNEL_PW = `pw ${RUN}`;

const results = [];
const check = (ok, name, detail = "") => {
  results.push([ok ? "PASS" : "FAIL", name, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ hub sessions ------------------------------ */

function connect(nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}/ws`, { origin: ORIGIN });
    const state = { ws, nickname, sessionId: "", uid: "", perms: {}, pending: new Map(), seq: 0 };
    state.recv = [];
    const timer = setTimeout(() => reject(new Error(`${nickname}: no connect in 30 s`)), 30_000);
    ws.on("error", reject);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "hello") {
        state.sessionId = msg.sessionId;
        ws.send(
          JSON.stringify({ type: "connect", host: TS_HOST, port: Number(TS_PORT), nickname }),
        );
      }
      if (msg.type === "perms")
        state.perms = msg.full ? msg.values : { ...state.perms, ...msg.values };
      if (msg.type === "log" && msg.scope === "recv") state.recv.push(msg.message);
      if (msg.type === "ts.cmdResult") state.pending.get(msg.id)?.(msg);
      if (msg.type === "connected") {
        state.uid = msg.uid;
        clearTimeout(timer);
        setTimeout(() => resolve(state), 1_000);
      }
      if (msg.type === "error" && msg.fatal) reject(new Error(`${msg.code}: ${msg.message}`));
    });
  });
}

function tsCmd(state, cmd, cmdArgs) {
  const id = `v${++state.seq}`;
  return new Promise((resolve) => {
    state.pending.set(id, (msg) => {
      state.pending.delete(id);
      resolve(msg);
    });
    state.ws.send(JSON.stringify({ type: "ts.cmd", id, cmd, args: cmdArgs }));
  });
}

async function upload(state, cid, path, text, cpw = CHANNEL_PW) {
  const query = new URLSearchParams({ cid, path });
  const res = await fetch(`${HUB}/api/files/upload?${query}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "x-session-id": state.sessionId,
      "content-type": "application/octet-stream",
      "x-ts-channel-password": encodeURIComponent(cpw),
    },
    body: Buffer.from(text),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** What `s` received from the server since `mark` (notify names only), minus the noise. */
const NOISE = /^(error|notifyclientupdated|notifyconnectioninfo|notifyclientneededpermissions)\b/;
const receivedSince = (s, mark) =>
  s.recv
    .slice(mark)
    .map((line) => line.split(" ")[0])
    .filter((name) => !NOISE.test(name));

const brief = (r) =>
  r.ok
    ? `ok ${r.rows.length} rows`
    : `${r.code} ${r.message}${r.failedPermission ? ` ${r.failedPermission}` : ""}`;

/* ---------------------------------- run ---------------------------------- */

async function run() {
  if (!Q_PASSWORD) throw new Error("--query-password (or E2E_QUERY_PASSWORD) is required");
  const sq = await ServerQuery.connect({
    host: Q_HOST,
    port: Number(Q_PORT),
    user: "serveradmin",
    password: Q_PASSWORD,
    sid: 1,
  });
  const [{ cid }] = await sq.cmd("channelcreate", {
    channel_name: RUN,
    channel_password: CHANNEL_PW,
    channel_flag_semi_permanent: 1,
  });
  const [{ cid: otherCid }] = await sq.cmd("channelcreate", {
    channel_name: `${RUN}-other`,
    channel_flag_semi_permanent: 1,
  });
  const admin = await connect(`${RUN}-admin`);
  const guest = await connect(`${RUN}-guest`);
  const dbIds = [];
  try {
    for (const s of [admin, guest]) {
      const [row] = await sq.cmd("clientgetdbidfromuid", { cluid: s.uid });
      dbIds.push(row.cldbid);
    }
    const groups = await sq.send("servergrouplist");
    const adminGroup = groups.find((g) => g.name === "Server Admin" && g.type === "1");
    await sq.cmd("servergroupaddclient", { sgid: adminGroup.sgid, cldbid: dbIds[0] });
    await sleep(1_500);
    await checks({
      sq,
      admin,
      guest,
      guestDbId: dbIds[1],
      cid: String(cid),
      otherCid: String(otherCid),
    });
  } finally {
    for (const s of [admin, guest]) s.ws.close();
    await sleep(500);
    for (const c of [cid, otherCid]) {
      await sq.cmd("channeldelete", { cid: c, force: 1 }).catch(() => undefined);
    }
    for (const cldbid of dbIds) await sq.cmd("clientdbdelete", { cldbid }).catch(() => undefined);
    sq.close();
  }
}

async function checks({ sq, admin, guest, guestDbId, cid, otherCid }) {
  const cpw = CHANNEL_PW;
  const cmd = (s, name, a) => tsCmd(s, name, a);
  const names = async (s, path = "/", c = cid, pw = cpw) => {
    const r = await tsCmd(s, "ftgetfilelist", { cid: c, path, cpw: pw });
    return r.ok
      ? r.rows.map((row) => `${row.type === "0" ? "d:" : ""}${row.name}`).sort()
      : [brief(r)];
  };
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  /** Runs `fn`, then reports whether anyone heard about it from the server. */
  async function quiet(label, fn) {
    const mark = [admin.recv.length, guest.recv.length];
    const out = await fn();
    await sleep(800);
    const heard = [...receivedSince(admin, mark[0]), ...receivedSince(guest, mark[1])];
    check(heard.length === 0, `${label}: the server notifies nobody`, heard.join(", "));
    return out;
  }

  const ftOf = (perms) =>
    Object.entries(perms)
      .filter(([k]) => /^[ib]_ft_/.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  console.log("guest file permissions reported:", ftOf(guest.perms));
  console.log("admin file permissions reported:", ftOf(admin.perms));
  check(
    guest.perms.i_ft_file_browse_power > 0 && !("i_ft_directory_create_power" in guest.perms),
    "a guest's powers: browse reported, the ones it lacks left out",
  );

  /* ---- create folders ---- */
  const mk = await quiet("ftcreatedir", () =>
    cmd(admin, "ftcreatedir", { cid, dirname: "/docs", cpw }),
  );
  check(mk.ok && mk.rows.length === 0, "admin: ftcreatedir /docs", brief(mk));
  check((await names(admin)).includes("d:docs"), "the folder is listed");
  const nested = await cmd(admin, "ftcreatedir", { cid, dirname: "/docs/sub", cpw });
  check(nested.ok, "admin: nested folder", brief(nested));
  const again = await cmd(admin, "ftcreatedir", { cid, dirname: "/docs", cpw });
  check(again.code === "2050", "an existing folder: 2050 (file exists)", brief(again));
  const orphan = await cmd(admin, "ftcreatedir", { cid, dirname: "/nope/deeper", cpw });
  check(orphan.code === "2052", "under a missing parent: 2052", brief(orphan));
  const guestMk = await cmd(guest, "ftcreatedir", { cid, dirname: "/guest", cpw });
  check(
    guestMk.failedPermission === "i_ft_needed_directory_create_power",
    "guest: ftcreatedir refused, naming the needed power",
    brief(guestMk),
  );

  /* ---- files to play with ---- */
  for (const p of ["/a.txt", "/b.txt", "/docs/c.txt", "/docs/d.txt", "/docs/e.txt"]) {
    const up = await upload(admin, cid, p, `content of ${p}`);
    check(up.status === 201, `upload ${p}`, `${up.status}`);
  }

  /* ---- rename ---- */
  const ren = await quiet("ftrenamefile", () =>
    cmd(admin, "ftrenamefile", { cid, cpw, oldname: "/a.txt", newname: "/a2.txt" }),
  );
  check(ren.ok, "admin: rename a file", brief(ren));
  check(same(await names(admin), ["a2.txt", "b.txt", "d:docs"]), "the new name is listed");
  const missing = await cmd(admin, "ftrenamefile", { cid, cpw, oldname: "/zz", newname: "/yy" });
  check(missing.code === "2052", "rename a missing file: 2052", brief(missing));
  const intoDir = await cmd(admin, "ftrenamefile", {
    cid,
    cpw,
    oldname: "/a2.txt",
    newname: "/docs/a2.txt",
  });
  check(intoDir.ok, "admin: move a file into a folder", brief(intoDir));
  const dirRen = await cmd(admin, "ftrenamefile", {
    cid,
    cpw,
    oldname: "/docs",
    newname: "/papers",
  });
  check(dirRen.ok, "admin: rename a folder (contents go along)", brief(dirRen));
  check(
    same(await names(admin, "/papers"), ["a2.txt", "c.txt", "d.txt", "e.txt", "d:sub"]),
    "the folder's contents moved with it",
  );
  // The server does not refuse a rename onto an existing name: it replaces
  // that file. The page has to check the listing itself.
  const onto = await cmd(admin, "ftrenamefile", {
    cid,
    cpw,
    oldname: "/papers/a2.txt",
    newname: "/b.txt",
  });
  const after = await names(admin);
  check(
    onto.ok && same(after, ["b.txt", "d:papers"]),
    "rename onto an existing name REPLACES it (no 2050)",
    `${brief(onto)}; / is ${after}`,
  );

  /* ---- across channels ---- */
  const cross = await cmd(admin, "ftrenamefile", {
    cid,
    cpw,
    tcid: otherCid,
    oldname: "/b.txt",
    newname: "/b.txt",
  });
  check(cross.ok, "admin: move a file to another channel", brief(cross));
  check(same(await names(admin, "/", otherCid, ""), ["b.txt"]), "it is in the other channel");

  // A guest given the powers, to see the passwords checked (admins ignore them).
  for (const permsid of ["i_ft_file_rename_power", "i_ft_directory_create_power"]) {
    await sq.cmd("clientaddperm", { cldbid: guestDbId, permsid, permvalue: 75, permskip: 0 });
  }
  await sleep(1_000);
  const gWrong = await cmd(guest, "ftcreatedir", { cid, dirname: "/g", cpw: "nope" });
  check(gWrong.code === "781", "guest with the power, wrong password: 781", brief(gWrong));
  const gRight = await cmd(guest, "ftcreatedir", { cid, dirname: "/g", cpw });
  check(gRight.ok, "guest with the power, right (hashed) password", brief(gRight));
  const gBadT = await cmd(guest, "ftrenamefile", {
    cid: otherCid,
    tcid: cid,
    tcpw: "nope",
    oldname: "/b.txt",
    newname: "/b.txt",
  });
  check(gBadT.code === "781", "move into a password channel, wrong tcpw: 781", brief(gBadT));
  const gGoodT = await cmd(guest, "ftrenamefile", {
    cid: otherCid,
    tcid: cid,
    tcpw: cpw,
    oldname: "/b.txt",
    newname: "/g/b.txt",
  });
  check(gGoodT.ok, "move into a password channel, tcpw hashed like cpw", brief(gGoodT));

  /* ---- delete ---- */
  const guestDel = await cmd(guest, "ftdeletefile", { cid, cpw, names: ["/papers/c.txt"] });
  check(
    guestDel.failedPermission === "i_ft_needed_file_delete_power",
    "guest: delete refused, naming the needed power",
    brief(guestDel),
  );
  const del = await quiet("ftdeletefile", () =>
    cmd(admin, "ftdeletefile", { cid, cpw, names: ["/papers/c.txt", "/papers/d.txt"] }),
  );
  check(del.ok, "admin: delete two files in one command", brief(del));
  check(same(await names(admin, "/papers"), ["e.txt", "d:sub"]), "both are gone");
  // Rows run in order and the first failure ends the command.
  const partial = await cmd(admin, "ftdeletefile", {
    cid,
    cpw,
    names: ["/papers/e.txt", "/zz", "/papers/sub"],
  });
  check(partial.code === "2054", "a missing path: 2054", brief(partial));
  check(
    same(await names(admin, "/papers"), ["d:sub"]),
    "rows before the failure are deleted, those after it are not",
    String(await names(admin, "/papers")),
  );
  await upload(admin, cid, "/papers/sub/x.txt", "x");
  const dirDel = await cmd(admin, "ftdeletefile", { cid, cpw, names: ["/papers", "/g"] });
  check(dirDel.ok, "admin: delete non-empty folders", brief(dirDel));
  check(same(await names(admin), []), "the channel is empty again", String(await names(admin)));
}

run()
  .catch((err) => {
    console.error(err);
    results.push(["FAIL", "run", String(err)]);
  })
  .finally(() => {
    const failed = results.filter(([s]) => s === "FAIL").length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
