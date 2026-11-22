/**
 * Whether this deployment pushes, and the [`Pusher`] when it does. Built once per process and
 * resolved lazily: the VAPID key may have to come from the database, which the api must not touch
 * at construction (`gen` builds the app with no database at all).
 */
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { ensureVapidKeys } from "./keys.ts";
import { Pusher } from "./pusher.ts";
import { createPushSender, type SenderOptions, type VapidKeys } from "./sender.ts";

/** The validated push configuration (`loadConfig`). */
export interface PushSettings {
  /** The public origin notifications link to; push is on only when it is https. */
  publicBaseUrl: string | null;
  /** The VAPID contact; defaults to `publicBaseUrl`. */
  subject: string | null;
  /** A configured pair; when null the shared generated pair in `vapid_keys` is used. */
  vapid: VapidKeys | null;
  allowedHosts: readonly string[];
  maxDevices: number;
}

export const DEFAULT_MAX_DEVICES = 10;

export interface PushService {
  readonly maxDevices: number;
  /** The pusher, or null while push is off. Rejects when the key cannot be read now. */
  pusher(): Promise<Pusher | null>;
}

/** Push off: what `gen` and tests without push use. */
export const disabledPush: PushService = {
  maxDevices: DEFAULT_MAX_DEVICES,
  pusher: () => Promise.resolve(null),
};

/** The https origin to link to, or null with the reason push stays off logged. */
function pushOrigin(settings: PushSettings, logger: Logger): string | null {
  const url = settings.publicBaseUrl;
  if (url?.startsWith("https://")) return url.replace(/\/+$/, "");
  logger.warn(
    { publicBaseUrl: url },
    "push notifications are off: UROBOROS_PUBLIC_BASE_URL must be an https URL (a notification " +
      "needs a link to open, and a service worker a secure origin)",
  );
  return null;
}

export function createPushService(
  settings: PushSettings,
  db: Kysely<Database>,
  logger: Logger,
  senderOverrides: Partial<SenderOptions> = {},
): PushService {
  const baseUrl = pushOrigin(settings, logger);
  let pending: Promise<Pusher> | null = null;

  async function build(origin: string): Promise<Pusher> {
    const vapid = settings.vapid ?? (await ensureVapidKeys(db));
    const sender = createPushSender({
      vapid,
      subject: settings.subject ?? origin,
      ...senderOverrides,
    });
    return new Pusher({ sender, db, baseUrl: origin, allowedHosts: settings.allowedHosts, logger });
  }

  return {
    maxDevices: settings.maxDevices,
    pusher() {
      if (baseUrl === null) return Promise.resolve(null);
      // A failed key read is not cached: the next request asks the database again.
      pending ??= build(baseUrl).catch((err: unknown) => {
        pending = null;
        throw err;
      });
      return pending;
    },
  };
}
