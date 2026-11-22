/** Thrown by `withDeadline` when the work did not settle in time. */
export class DeadlineError extends Error {
  override readonly name = "DeadlineError";
}

/**
 * Settles as `work` does, or rejects with a `DeadlineError(message)` after `ms`. The work itself
 * is not cancelled: the caller frees whatever it holds (a socket, say) when the deadline wins.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineError(message));
    }, ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts; true when it was the abort. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves once `signal` aborts (never, if it never does). Its listener stays on `signal` until
 * then, or until `until` aborts: a caller that races this against other work and may go on
 * without it passes `until` and aborts it when done, or every call leaves a listener behind.
 */
export function aborted(signal: AbortSignal, until?: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true, ...(until === undefined ? {} : { signal: until }) },
    );
  });
}
