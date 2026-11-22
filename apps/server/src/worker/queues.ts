/**
 * Every BullMQ queue. Later steps add `download`, `transcode` and `automation`. `notify` is
 * declared for Web Push (docs/push.md): the features that emit events (a download finished or
 * failed, a subscription found something) add its jobs and its processor, which sends through
 * `src/push/pusher.ts`. Until then no worker serves it.
 */
export const QUEUE_NAMES = { system: "system", notify: "notify" } as const;

/** Default BullMQ key prefix; tests pass their own so they never touch each other's keys. */
export const DEFAULT_PREFIX = "uroboros";

/** Payload of the system queue's `ping` job. */
export interface PingData {
  at: string;
}

/** Result of the system queue's `ping` job. */
export interface PingResult {
  pong: true;
}
