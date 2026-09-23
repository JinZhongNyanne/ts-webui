/**
 * Main-thread handle on the level worker: a promise for the new counter,
 * progress callbacks, and a cancel that kills the worker outright.
 */
import type { WorkerReply, WorkerRequest } from "./levelSearch";

export interface LevelJob {
  result: Promise<bigint>;
  cancel: () => void;
}

export class LevelSearchCancelled extends Error {
  constructor() {
    super("security level search cancelled");
    this.name = "LevelSearchCancelled";
  }
}

export function raiseLevel(
  publicKey: string,
  start: bigint,
  target: number,
  onProgress: (tried: number) => void,
): LevelJob {
  const worker = new Worker(new URL("./levelWorker.ts", import.meta.url), { type: "module" });
  let settle: { reject: (e: Error) => void } | null = null;
  const result = new Promise<bigint>((resolve, reject) => {
    settle = { reject };
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const msg = ev.data;
      if (msg.type === "progress") onProgress(msg.tried);
      else {
        worker.terminate();
        resolve(BigInt(msg.offset));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "security level worker failed"));
    };
  });
  const req: WorkerRequest = { publicKey, start: start.toString(), target };
  worker.postMessage(req);
  return {
    result,
    cancel: () => {
      worker.terminate();
      settle?.reject(new LevelSearchCancelled());
    },
  };
}
