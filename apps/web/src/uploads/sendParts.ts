import type { Upload } from "@uroboros/contract";

import { ApiError } from "@/api/client";

/** Sends one part; `onProgress` hears how many of its bytes have gone. */
export type PutPart = (
  n: number,
  part: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) => Promise<void>;

export interface PartsInput {
  upload: Pick<Upload, "size" | "partSize" | "receivedParts">;
  file: Blob;
  put: PutPart;
  /** Hears the bytes the server holds or is receiving, as they grow. */
  onProgress: (sent: number) => void;
  signal: AbortSignal;
  /** Tries again after a failure, per part. Default 3. */
  retries?: number;
  /** Waits before a retry (tests skip it). */
  wait?: (ms: number) => Promise<void>;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A network failure or a server error is worth another try; a refusal (4xx) is not. */
function retryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
}

/**
 * Sends an upload's parts the server does not have yet, one at a time in order, each part again
 * after a failure (1 s, 3 s, 9 s apart) before giving up (docs/uploads.md).
 */
export async function sendParts(i: PartsInput): Promise<void> {
  const { size, partSize } = i.upload;
  const count = Math.ceil(size / partSize);
  const have = new Set(i.upload.receivedParts);
  const sizeOf = (n: number) => Math.min(partSize, size - (n - 1) * partSize);
  let done = [...have].reduce((sum, n) => sum + sizeOf(n), 0);
  i.onProgress(done);
  const retries = i.retries ?? 3;
  const wait = i.wait ?? pause;
  for (let n = 1; n <= count; n++) {
    if (have.has(n)) continue;
    i.signal.throwIfAborted();
    const start = (n - 1) * partSize;
    const part = i.file.slice(start, start + sizeOf(n));
    for (let attempt = 0; ; attempt++) {
      try {
        await i.put(
          n,
          part,
          (loaded) => {
            i.onProgress(done + loaded);
          },
          i.signal,
        );
        break;
      } catch (err) {
        if (i.signal.aborted || attempt >= retries || !retryable(err)) throw err;
        await wait(1000 * 3 ** attempt);
      }
    }
    done += part.size;
    i.onProgress(done);
  }
  i.signal.throwIfAborted();
}
