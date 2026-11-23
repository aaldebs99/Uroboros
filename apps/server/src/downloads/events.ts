import { DownloadProgress } from "@uroboros/contract";
import type { Redis } from "ioredis";

/** What replicas tell each other about downloads, on one Valkey channel. */
export type InternalEvent =
  | { kind: "state"; downloadId: string; userId: string }
  | { kind: "progress"; fetchKey: string; progress: DownloadProgress }
  | { kind: "removed"; downloadId: string; userId: string };

export const eventsChannel = (prefix: string): string => `${prefix}:downloads:events`;
/** `{ fetchKey }`: the replica running that fetch aborts it. */
export const cancelChannel = (prefix: string): string => `${prefix}:downloads:cancel`;
export const progressKey = (prefix: string, key: string): string => `${prefix}:progress:${key}`;

/** How long the latest progress of a fetch is kept for page loads. */
export const PROGRESS_TTL_S = 60;

export async function publishDownloadEvent(
  valkey: Redis,
  prefix: string,
  event: InternalEvent,
): Promise<void> {
  await valkey.publish(eventsChannel(prefix), JSON.stringify(event));
}

export async function publishCancel(valkey: Redis, prefix: string, key: string): Promise<void> {
  await valkey.publish(cancelChannel(prefix), JSON.stringify({ fetchKey: key }));
}

/** The latest progress of each fetch key that has one. */
export async function latestProgress(
  valkey: Redis,
  prefix: string,
  keys: readonly string[],
): Promise<Map<string, DownloadProgress>> {
  const out = new Map<string, DownloadProgress>();
  if (keys.length === 0) return out;
  const values = await valkey.mget(...keys.map((k) => progressKey(prefix, k)));
  keys.forEach((key, i) => {
    const raw = values[i];
    if (raw === null || raw === undefined) return;
    const parsed = DownloadProgress.safeParse(JSON.parse(raw));
    if (parsed.success) out.set(key, parsed.data);
  });
  return out;
}
