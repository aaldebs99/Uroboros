import type { StoredDevice } from "./stored";

/**
 * What a launch does about this browser's notifications. Subscriptions vanish without notice (iOS
 * drops them, a reinstall makes a new one), so every launch checks and mends what it can.
 */
export type SyncAction =
  /** Nothing to do. */
  | "none"
  /** Permission is gone: this browser is no device any more. */
  | "forget"
  /** The subscription is gone: subscribe again (permission still stands) and register. */
  | "resubscribe"
  /** The subscription changed, or the server forgot the device: register it again. */
  | "register"
  /** The person turned this device off from another device: leave it off, and say so here. */
  | "turnedOff";

export interface SyncState {
  permission: NotificationPermission;
  /** This browser's subscription's endpoint, if it has one. */
  endpoint: string | null;
  stored: StoredDevice | null;
  /** The ids of the person's devices on the server. */
  serverDevices: string[];
  /** The server remembers this browser's endpoint as turned off from another device. */
  turnedOffElsewhere: boolean;
}

export function syncAction(state: SyncState): SyncAction {
  const { permission, endpoint, stored, serverDevices, turnedOffElsewhere } = state;
  if (!stored) return "none";
  if (permission !== "granted") return "forget";
  if (endpoint === null) return "resubscribe";
  if (endpoint !== stored.endpoint) return "register";
  if (serverDevices.includes(stored.id)) return "none";
  return turnedOffElsewhere ? "turnedOff" : "register";
}
