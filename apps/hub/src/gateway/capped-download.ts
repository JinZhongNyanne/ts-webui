/**
 * Collects a channel-0 download into memory, within a byte cap and a
 * deadline. The server announces a size, but the file port sends what it
 * sends; and the client library's download never settles when its socket
 * times out, which would hold the hub-wide pace queue for good.
 */
import { Writable } from "node:stream";

export class DownloadTooLarge extends Error {
  constructor(readonly maxBytes: number) {
    super(`download larger than ${maxBytes} bytes`);
    this.name = "DownloadTooLarge";
  }
}

export class DownloadTimeout extends Error {
  constructor() {
    super("download did not finish in time");
    this.name = "DownloadTimeout";
  }
}

/**
 * Runs `download` into a sink and resolves with the bytes; rejects with
 * DownloadTooLarge past `maxBytes` and DownloadTimeout past `timeoutMs`
 * (the sink is destroyed either way, which ends the library's pipe).
 */
export async function collectCapped(
  download: (sink: Writable) => Promise<void>,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let received = 0;
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      received += chunk.length;
      if (received > maxBytes) {
        done(new DownloadTooLarge(maxBytes));
        return;
      }
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  // Destroying a stream emits 'error'; without a listener Node raises it as an
  // uncaught exception. The reason travels through the race instead.
  sink.on("error", () => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DownloadTimeout();
      sink.destroy(err);
      reject(err);
    }, timeoutMs);
  });
  // Destroying the sink makes the download reject too, a moment after the
  // race is already decided: without a catch of its own that rejection has
  // nobody waiting for it, and Node reports it as unhandled.
  const running = download(sink);
  running.catch(() => undefined);
  try {
    await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks);
}
