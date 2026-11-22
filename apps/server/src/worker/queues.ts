/** Every BullMQ queue the worker serves. Later steps add `download`, `transcode` and `automation`. */
export const QUEUE_NAMES = { system: "system" } as const;

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
