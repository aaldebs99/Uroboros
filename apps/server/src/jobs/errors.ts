/** Thrown by a job to fail for good: no retry, whatever attempts are left. */
export class UnrecoverableError extends Error {
  override readonly name = "UnrecoverableError";
}

/**
 * Thrown by a job to go back to its queue unfinished, without spending an attempt (a shutdown cut,
 * say). It runs again after `delayMs`, on any replica.
 */
export class RequeueError extends Error {
  override readonly name = "RequeueError";
  constructor(
    readonly delayMs = 0,
    options?: ErrorOptions,
  ) {
    super("put back in the queue", options);
  }
}
