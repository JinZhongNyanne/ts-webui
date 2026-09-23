/**
 * Mic mute means silence. TeamSpeak's `client_input_muted` flag alone does
 * not stop a client's voice packets, so both the page (stops encoding) and
 * the hub (drops frames) enforce it. Chromium's fake microphone beeps
 * continuously, which keeps voice activation open while unmuted.
 */
import assert from "node:assert/strict";

export const title = "voice: a muted microphone sends nothing, unmuting resumes";

/** Starts audio and the microphone, the way a user does from the status bar. */
async function startMic(page) {
  const mic = page.getByTestId("voice-mic");
  await mic.click(); // start audio (enables the mic when auto-mic is on)
  await page.waitForTimeout(500);
  const label = await mic.innerText();
  if (/Microphone off|麦克风已关闭|麦克风关/.test(label ?? "")) await mic.click();
}

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

async function toggleMicMute(page) {
  await page
    .getByTitle(/Mute microphone|麦克风静音/)
    .first()
    .click();
}

export default async function voiceMute(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const bob = await rig.connect("bob", { channel: "a" });
  await rig.waitForClientInTree(bob.page, alice.nick);

  // Bob needs a running engine to decode (and so to see Alice talk).
  await bob.page.getByTestId("voice-mic").click();
  await startMic(alice.page);

  assert.ok(await seenTalking(bob.page, alice.nick, 15_000), "bob hears alice before muting");

  await toggleMicMute(alice.page);
  await alice.page.waitForFunction(() => window.__jinzTs?.self()?.inputMuted === true);
  // Let the last in-flight frames and the talk hangover drain.
  await bob.page.waitForTimeout(1_500);
  assert.equal(
    await seenTalking(bob.page, alice.nick, 5_000),
    false,
    "bob hears nothing from alice while she is muted",
  );
  assert.doesNotMatch(
    await alice.page.getByTestId("voice-mic").innerText(),
    /Talking|说话/,
    "alice's own indicator does not claim she is talking",
  );

  await toggleMicMute(alice.page);
  assert.ok(
    await seenTalking(bob.page, alice.nick, 15_000),
    "bob hears alice again after unmuting",
  );
}
