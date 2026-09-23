import { Transform, type TransformCallback } from "node:stream";

/** A transfer ended with more or fewer bytes than announced. */
export class TransferLengthError extends Error {
  constructor(
    readonly expected: number,
    readonly received: number,
  ) {
    super(`transfer length mismatch: expected ${expected} bytes, got ${received}`);
    this.name = "TransferLengthError";
  }
}

/**
 * Passes bytes through and fails the stream unless exactly `expected` go by.
 *
 * Both directions need it: TeamSpeak takes an upload of the size announced in
 * `ftinitupload` and nothing else, and a download whose file-port connection
 * closes early must reach the browser as a broken transfer, not as a
 * complete but short file.
 */
export class ExactLength extends Transform {
  private count = 0;

  constructor(private readonly expected: number) {
    super();
  }

  /** Bytes that went through so far. */
  get received(): number {
    return this.count;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.count += chunk.length;
    if (this.count > this.expected) {
      done(new TransferLengthError(this.expected, this.count));
      return;
    }
    done(null, chunk);
  }

  override _flush(done: TransformCallback): void {
    done(this.count === this.expected ? null : new TransferLengthError(this.expected, this.count));
  }
}
