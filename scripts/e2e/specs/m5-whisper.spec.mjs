/**
 * Whisper (roadmap M5): holding the whisper key sends Alice's voice to her
 * whisper list only. Bob, in another channel and on the list, sees her in the
 * whisper style; Carol, in Alice's own channel but not on the list, sees
 * nothing at all. Then Bob blocks whispers and stops seeing them too.
 *
 * Alice is on push to talk, so Chromium's fake microphone (a continuous beep)
 * reaches nobody unless a key is held.
 *
 * Last, whisper power. As a guest, Alice's power is unknown to the page (the
 * server tells only those with b_client_permissionoverview_own), and nothing
 * is said. In the Normal group the server reports it as 0, and the pill and
 * the pane warn that the whisper may reach nobody — without stopping the key.
 * Given some power, the warning goes.
 */
import assert from "node:assert/strict";

export const title = "whisper: a whisper list reaches its target and nobody else";

const WHISPER_KEY = "KeyB";

/** True if `selector` for `nick` matches on `page` at any point within `ms`. */
async function seen(page, selector, nick, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await page.locator(selector, { hasText: nick }).count()) > 0) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/** The mic button's visible label (its other labels are laid out but hidden). */
const micLabel = (page) => page.getByTestId("voice-mic").innerText();

/** Starts the audio engine the way a user does, from the status bar. */
async function startAudio(page) {
  await page.getByTestId("voice-mic").click();
  await page.waitForFunction(
    () => !/Start audio/.test(document.querySelector("[data-testid=voice-mic]")?.innerText ?? ""),
  );
}

/** Starts a listener's audio engine, with its microphone off. */
async function listenOnly(page) {
  await startAudio(page);
  if (!/Microphone off/.test(await micLabel(page))) await page.getByTestId("voice-mic").click();
  await page.waitForFunction(() =>
    /Microphone off/.test(document.querySelector("[data-testid=voice-mic]")?.innerText ?? ""),
  );
}

/** Starts audio with the microphone on (auto-mic may or may not have done that). */
async function startMic(page) {
  await startAudio(page);
  if (/Microphone off/.test(await micLabel(page))) await page.getByTestId("voice-mic").click();
  await page.waitForFunction(
    () =>
      !/Microphone off/.test(document.querySelector("[data-testid=voice-mic]")?.innerText ?? ""),
  );
}

async function openSettingsTab(page, tab) {
  const panel = page.locator(".dialog-panel");
  if (!(await panel.isVisible())) await page.getByTestId("status-settings").click();
  await panel.getByTestId(`settings-tab-${tab}`).click();
  return panel;
}

export default async function whisper(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const bob = await rig.connect("bob", { channel: "b" });
  const carol = await rig.connect("carol", { channel: "a" });
  for (const nick of [bob.nick, carol.nick]) await rig.waitForClientInTree(alice.page, nick);
  await rig.waitForClientInTree(bob.page, alice.nick);
  await rig.waitForClientInTree(carol.page, alice.nick);

  await listenOnly(bob.page);
  await listenOnly(carol.page);

  // Alice: push to talk, Bob on the whisper list, the whisper key bound.
  const { page } = alice;
  let panel = await openSettingsTab(page, "mic");
  await panel
    .locator("select")
    .filter({ has: page.locator("option[value=ptt]") })
    .selectOption("ptt");
  panel = await openSettingsTab(page, "whisper");
  await panel.getByTestId("whisper-add-client").selectOption({ label: bob.nick });
  await panel.getByText(/reach 0 channels and 1 people/).waitFor();
  panel = await openSettingsTab(page, "hotkeys");
  const recorder = panel.locator(".binding[data-action=whisper] .recorder");
  await recorder.click();
  await page.keyboard.press(WHISPER_KEY);
  await panel.locator(".binding[data-action=whisper] .recorder", { hasText: "B" }).waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });

  await startMic(page);
  assert.equal(
    await seen(carol.page, ".client.talking", alice.nick, 3_000),
    false,
    "with no key held, alice's beeping microphone reaches nobody",
  );

  // Whisper.
  await page.bringToFront();
  await page.keyboard.down(WHISPER_KEY);
  try {
    await page
      .getByTestId("whisper-pill")
      .filter({ hasText: /0 channels · 1 people/ })
      .waitFor();
    assert.ok(
      await seen(bob.page, ".client.whispering", alice.nick, 15_000),
      "bob sees alice whispering to him, in the whisper style",
    );
    assert.equal(
      await seen(carol.page, ".client.talking", alice.nick, 4_000),
      false,
      "carol, in alice's own channel, hears nothing of the whisper",
    );
    assert.ok(
      await seen(page, ".client.whispering", alice.nick, 2_000),
      "alice sees her own whisper marked as one",
    );
    assert.equal(
      await page.getByTestId("whisper-power-hint").count(),
      0,
      "a whisper power the page does not know is not a zero: no warning",
    );
  } finally {
    await page.keyboard.up(WHISPER_KEY);
  }
  await page.getByTestId("whisper-pill").waitFor({ state: "detached" });
  await bob.page
    .locator(".client.talking", { hasText: alice.nick })
    .waitFor({ state: "detached", timeout: 10_000 });

  // Bob blocks whispers: the next one reaches him unheard and unmarked.
  panel = await openSettingsTab(bob.page, "whisper");
  await panel.getByTestId("whisper-policy-block").check();
  await bob.page.keyboard.press("Escape");
  await page.bringToFront();
  await page.keyboard.down(WHISPER_KEY);
  try {
    await page.getByTestId("whisper-pill").waitFor();
    assert.equal(
      await seen(bob.page, ".client.talking", alice.nick, 5_000),
      false,
      "bob, blocking whispers, neither hears nor sees alice's whisper",
    );
  } finally {
    await page.keyboard.up(WHISPER_KEY);
  }

  await whisperPower(rig, alice);
}

/** The warning for a whisper power the server reported as 0, and its going away. */
async function whisperPower(rig, alice) {
  const { page } = alice;
  const normal = (await rig.sq.cmd("servergrouplist")).find(
    (g) => g.name === "Normal" && g.type === "1",
  );
  assert.ok(normal, "the server has a regular Normal group");
  /** A group of this run's with some whisper power, made further down. */
  let powered = null;
  await rig.sq.cmd("servergroupaddclient", { sgid: normal.sgid, cldbid: alice.dbId });
  try {
    // The pane says it as soon as the power is known.
    const panel = await openSettingsTab(page, "whisper");
    const paneHint = panel.getByTestId("whisper-power-hint");
    await paneHint.waitFor({ timeout: 15_000 });
    assert.match(await paneHint.innerText(), /no whisper power/i);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });

    // The pill says it while the key is held, and the whisper still goes out.
    await page.bringToFront();
    await page.keyboard.down(WHISPER_KEY);
    try {
      const pill = page.getByTestId("whisper-pill");
      await pill.getByTestId("whisper-power-hint").waitFor();
      assert.match(await pill.innerText(), /No whisper power/);
      assert.ok(
        await seen(page, ".client.whispering", alice.nick, 10_000),
        "the key is not blocked: alice is still whispering",
      );
      await page.screenshot({ path: rig.artifact("m5-whisper-no-power.png") });
    } finally {
      await page.keyboard.up(WHISPER_KEY);
    }
    await page.getByTestId("whisper-pill").waitFor({ state: "detached" });

    // Some power, and the warning goes. Through a group: the server tells a
    // client its permissions again when its groups change, which is when the
    // hub asks for its powers anew (own-perms.ts).
    const [made] = await rig.sq.cmd("servergroupadd", { name: `${rig.prefix} whisper`, type: 1 });
    powered = made.sgid;
    await rig.sq.cmd("servergroupaddperm", {
      sgid: powered,
      permsid: "i_client_whisper_power",
      permvalue: 50,
      permnegated: 0,
      permskip: 0,
    });
    await rig.sq.cmd("servergroupaddclient", { sgid: powered, cldbid: alice.dbId });
    const again = await openSettingsTab(page, "whisper");
    await again.getByTestId("whisper-power-hint").waitFor({ state: "detached", timeout: 15_000 });
    await page.keyboard.press("Escape");
  } finally {
    await rig.sq
      .cmd("servergroupdelclient", { sgid: normal.sgid, cldbid: alice.dbId })
      .catch(() => undefined);
    if (powered) {
      await rig.sq.cmd("servergroupdel", { sgid: powered, force: 1 }).catch(() => undefined);
    }
  }
}
