/**
 * The soundboard: the clips are the hub's and shared by everyone on it, and
 * playing one sends it into the voice channel. "Heard" is judged the way
 * voice-mute.spec.mjs does it: the listener's tree marks the player as
 * talking. Chromium's fake microphone beeps without pause, so the player
 * first turns the mic off (the clip must go out without one), then uses
 * push-to-talk with the key up (the clip must open the gate on its own).
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title = "soundboard: shared clips, live edits, playing into the channel";

const CLIP_SECONDS = 2.5;

/** A mono 16-bit WAV of a loud 440 Hz tone. */
function toneWav(seconds, rate = 48_000) {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16_000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function openSoundboard(page, rig) {
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor();
}

const names = (page) => page.locator(".soundboard [data-testid=sound-name]").allInnerTexts();

function talkingRow(page, nick) {
  return page.locator(".client.talking", { hasText: nick });
}

/** True if `nick` shows as talking at any point within `ms`. */
async function seenTalking(page, nick, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await talkingRow(page, nick).count()) > 0) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/** Sets voice settings through the page's own store, as the settings panel would. */
function setVoice(page, patch) {
  return page.evaluate((p) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    Object.assign(pinia._s.get("voice"), p);
  }, patch);
}

function voiceState(page, key) {
  return page.evaluate((k) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    return pinia._s.get("voice")[k];
  }, key);
}

export default async function soundboard(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const bob = await rig.connect("bob", { channel: "a" });
  await rig.waitForClientInTree(bob.page, alice.nick);
  await openSoundboard(alice.page, rig);
  await openSoundboard(bob.page, rig);
  // Bob needs a running engine to decode (and so to see Alice talk).
  await bob.page.getByTestId("voice-mic").click();

  // Alice uploads; the name field wins over the file name.
  const a = alice.page;
  await a.getByTestId("sound-upload-name").fill("e2e horn");
  await a.getByTestId("sound-upload-file").setInputFiles({
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: toneWav(CLIP_SECONDS),
  });
  await until(async () => (await names(a)).includes("e2e horn"), "alice sees her upload");

  // A file that is no audio is refused before it leaves the page.
  await a.getByTestId("sound-upload-file").setInputFiles({
    name: "fake.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("<html>not audio</html>"),
  });
  await a.getByTestId("sound-upload-error").waitFor();

  // Bob sees it without reloading, renames it, and alice sees the new name.
  await until(async () => (await names(bob.page)).includes("e2e horn"), "bob sees the upload");
  await bob.page.getByTestId("sound-rename").first().click();
  await bob.page.getByTestId("sound-rename-input").fill("honk");
  await bob.page.getByTestId("sound-rename-input").press("Enter");
  await until(async () => (await names(a)).join() === "honk", "alice sees bob's rename");

  // Who uploaded it shows on hover.
  const tip = await bob.page.getByTestId("sound-play").first().getAttribute("title");
  assert.match(tip ?? "", new RegExp(alice.nick));

  // 1. Alice's microphone is off (connecting turned it on): the clip goes out without one.
  if (await voiceState(a, "micEnabled")) await a.getByTestId("voice-mic").click();
  await until(async () => !(await voiceState(a, "micEnabled")), "alice's mic is off");
  await until(
    async () => (await talkingRow(bob.page, alice.nick).count()) === 0,
    "alice falls silent with her mic off",
    10_000,
  );
  assert.equal(await seenTalking(bob.page, alice.nick, 1_500), false, "alice stays silent");
  await a.getByTestId("sound-play").first().click();
  assert.ok(await seenTalking(bob.page, alice.nick, 5_000), "bob hears the clip (no mic)");
  await until(
    async () => (await talkingRow(bob.page, alice.nick).count()) === 0,
    "alice stops talking after the clip",
    10_000,
  );

  // 2. Mic on, push to talk, key up: the beeping mic stays shut, the clip still goes out.
  await setVoice(a, { mode: "ptt", pttPressed: false });
  await a.getByTestId("voice-mic").click(); // the engine runs: this turns the mic back on
  await until(() => voiceState(a, "micEnabled"), "alice's mic is on again");
  await a.waitForTimeout(500);
  assert.equal(
    await seenTalking(bob.page, alice.nick, 2_000),
    false,
    "push to talk keeps alice's mic closed",
  );
  await a.getByTestId("sound-play").first().click();
  assert.ok(await seenTalking(bob.page, alice.nick, 5_000), "bob hears the clip in PTT");
  // Stop all ends it early.
  await a.getByTestId("sound-stop-all").click();
  await until(
    async () => (await talkingRow(bob.page, alice.nick).count()) === 0,
    "stop all ends the transmission",
    5_000,
  );

  // 3. Mic muted: the clip is not sent, and the page says why.
  await a
    .getByTitle(/Mute microphone|麦克风静音/)
    .first()
    .click();
  await a.waitForFunction(() => window.__jinzTs?.self()?.inputMuted === true);
  await a.getByTestId("sound-muted").waitFor();
  await a.getByTestId("sound-play").first().click();
  assert.equal(
    await seenTalking(bob.page, alice.nick, 3_000),
    false,
    "nothing is sent while alice's mic is muted",
  );

  // Deleting (with a confirm) removes it for both.
  await bob.page.getByTestId("sound-delete").first().click();
  await bob.page.locator("[role=dialog][aria-modal=true] button.danger").click();
  await until(async () => (await names(a)).length === 0, "alice's board empties");
  await until(async () => (await names(bob.page)).length === 0, "bob's board empties");
}
