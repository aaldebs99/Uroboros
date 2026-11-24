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
  /** The first retry's wait, tripled for each after it. Default 1000. */
  baseMs?: number;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A network failure or a server error is worth another try; a refusal (4xx) is not. */
export function retryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
}

/**
 * Runs `fn`, again after a network failure or a server error (a deploy's 502 or 503), `retries`
 * times at most, `baseMs` then three times longer each time apart. A refusal throws at once.
 */
export async function retrying<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  opts: { retries?: number; baseMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const wait = opts.wait ?? pause;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || attempt >= retries || !retryable(err)) throw err;
      await wait((opts.baseMs ?? 1000) * 3 ** attempt);
    }
  }
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
  const retry = {
    retries: i.retries ?? 3,
    baseMs: i.baseMs ?? 1000,
    ...(i.wait === undefined ? {} : { wait: i.wait }),
  };
  for (let n = 1; n <= count; n++) {
    if (have.has(n)) continue;
    i.signal.throwIfAborted();
    const start = (n - 1) * partSize;
    const part = i.file.slice(start, start + sizeOf(n));
    await retrying(
      () =>
        i.put(
          n,
          part,
          (loaded) => {
            i.onProgress(done + loaded);
          },
          i.signal,
        ),
      i.signal,
      retry,
    );
    done += part.size;
    i.onProgress(done);
  }
  i.signal.throwIfAborted();
}
