/// <reference lib="webworker" />
/**
 * Runs the security level search off the main thread. Cancelling is done by
 * terminating the worker, so the loop never has to poll for a stop flag.
 */
import { searchChunk, type WorkerReply, type WorkerRequest } from "./levelSearch";

/** Big enough to keep message overhead negligible, small enough for ~10 progress ticks a second. */
const CHUNK = 20_000;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { publicKey, target } = ev.data;
  let next = BigInt(ev.data.start);
  let tried = 0;
  const post = (reply: WorkerReply): void => self.postMessage(reply);
  for (;;) {
    const r = searchChunk(publicKey, next, target, CHUNK);
    tried += Number(r.next - next) + (r.found === null ? 0 : 1);
    if (r.found !== null) {
      post({ type: "done", offset: r.found.toString(), tried });
      return;
    }
    next = r.next;
    post({ type: "progress", tried, next: next.toString() });
  }
};
