/**
 * Talk power (roadmap D1): the server silently drops voice from a client
 * without enough talk power, so the page must not claim to be talking nor
 * upload anything. Chromium's fake microphone beeps continuously, which keeps
 * voice activation open the whole time.
 *
 * The phone's voice bar has the same state, with the reason spelt out (a
 * phone shows no tooltips) and a talk-power request a fingertip can hit.
 */
import assert from "node:assert/strict";

export const title = "talk power: without it the mic says so and nothing is sent";

/** Far above any default group's talk power. */
const NEEDED = 1000;
/** `--touch-target` in styles/base.css: the smallest a fingertip control may be. */
const TOUCH_TARGET_PX = 44;
const PHONE = { width: 390, height: 844 };

const micLabel = (page) => page.getByTestId("voice-mic").innerText();

async function startAudio(page) {
  await page.getByTestId("voice-mic").click();
  await page.waitForFunction(
    () => !/Start audio/.test(document.querySelector("[data-testid=voice-mic]")?.innerText ?? ""),
  );
}

async function seenTalking(page, nick, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await page.locator(".client.talking", { hasText: nick }).count()) > 0) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

export default async function talkPower(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const carol = await rig.connect("carol", { channel: "a" });
  await rig.waitForClientInTree(carol.page, alice.nick);

  await startAudio(carol.page);
  if (!/Microphone off/.test(await micLabel(carol.page))) {
    await carol.page.getByTestId("voice-mic").click();
  }
  await startAudio(alice.page);
  if (/Microphone off/.test(await micLabel(alice.page))) {
    await alice.page.getByTestId("voice-mic").click();
  }
  assert.ok(await seenTalking(carol.page, alice.nick, 15_000), "carol hears alice to begin with");

  await rig.sq.cmd("channeledit", { cid: rig.channels.a, channel_needed_talk_power: NEEDED });
  const mic = alice.page.getByTestId("voice-mic");
  await alice.page.locator('[data-testid=voice-mic][data-can-talk="false"]').waitFor();
  await alice.page.waitForFunction(() =>
    /No talk power/.test(document.querySelector("[data-testid=voice-mic]")?.innerText ?? ""),
  );
  // Let the last frames and the voice-activation hangover drain.
  await carol.page.waitForTimeout(1_500);
  assert.equal(
    await seenTalking(carol.page, alice.nick, 4_000),
    false,
    "carol hears nothing from alice once the channel needs more talk power",
  );
  assert.equal(
    await seenTalking(alice.page, alice.nick, 1_000),
    false,
    "alice's own tree does not show her talking",
  );
  assert.doesNotMatch(await mic.innerText(), /Talking/, "alice's mic does not claim she talks");

  // Made a talker (a granted talk request): she may talk again at once.
  await rig.sq.cmd("clientedit", { clid: alice.clid, client_is_talker: 1 });
  await alice.page.locator('[data-testid=voice-mic][data-can-talk="true"]').waitFor();
  assert.ok(
    await seenTalking(carol.page, alice.nick, 15_000),
    "carol hears alice again once she is a talker",
  );

  await phoneVoiceBar(rig, carol);

  await rig.sq.cmd("channeledit", { cid: rig.channels.a, channel_needed_talk_power: 0 });
}

/**
 * The phone's voice bar, in a channel that still needs NEEDED talk power;
 * `carol`, on a desktop in the same channel, sees the request arrive.
 */
async function phoneVoiceBar(rig, carol) {
  const dave = await rig.connect("dave", { channel: "a", viewport: PHONE });
  const page = dave.page;
  const mic = page.getByTestId("mobile-voice-mic");
  await mic.waitFor({ timeout: 15_000 });
  await mic.click(); // starts the audio engine, and the mic with it when auto-mic is on
  await page.waitForFunction(
    () =>
      !/Start audio/.test(
        document.querySelector("[data-testid=mobile-voice-mic]")?.textContent ?? "",
      ),
  );
  if (/Microphone off/.test(await mic.innerText())) await mic.click();

  await page.locator('[data-testid=mobile-voice-mic][data-can-talk="false"]').waitFor();
  await page.waitForFunction(() =>
    /No talk power/.test(
      document.querySelector("[data-testid=mobile-voice-mic]")?.textContent ?? "",
    ),
  );
  const note = page.getByTestId("mobile-no-talk-power");
  await note.waitFor();
  assert.match(await note.innerText(), /needs talk power/, "the phone says why");
  await page.screenshot({ path: rig.artifact("m5-talk-power-phone.png") });

  const request = page.getByTestId("mobile-talk-request");
  await request.waitFor();
  const box = await request.boundingBox();
  assert.ok(
    box && box.height >= TOUCH_TARGET_PX,
    `the request button is a touch target (${box?.height}px tall)`,
  );
  const micBox = await mic.boundingBox();
  assert.ok(micBox && micBox.height >= TOUCH_TARGET_PX, "so is the mic button");
  await request.click();
  // The test id sits on the dialog's field; the submit button is in its footer.
  const dialog = page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ has: page.getByTestId("talk-request-dialog") });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  // Another client sees the request: the server has it.
  await rig.waitForClientInTree(carol.page, dave.nick);
  await carol.page
    .locator(".tree .client", { hasText: dave.nick })
    .getByTestId("talk-request-marker")
    .waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    /Requesting talk power/.test(
      document.querySelector("[data-testid=mobile-talk-request]")?.textContent ?? "",
    ),
  );

  // Granted: the bar is an ordinary mic again, and the note goes.
  await rig.sq.cmd("clientedit", { clid: dave.clid, client_is_talker: 1 });
  await page.locator('[data-testid=mobile-voice-mic][data-can-talk="true"]').waitFor();
  await note.waitFor({ state: "detached" });
}
