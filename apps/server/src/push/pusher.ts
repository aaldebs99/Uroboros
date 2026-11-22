/**
 * Sends a user's notifications: the deployment's sender, their devices, and what each push's
 * outcome means for the device. The api's test route uses it now; the worker's `notify` queue
 * will use it for download and subscription events.
 */
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { checkSubscription, SubscriptionError } from "./endpoint.ts";
import { forgetDevice, listDevices, markDevice, type DeviceRow } from "./devices.ts";
import { buildPayload, encodePayload, FALLBACK_TITLE } from "./payload.ts";
import type { PushOutcome, PushSender, Urgency } from "./sender.ts";

/** A notification before it has a link: `path` is on the app's own origin. */
export interface Message {
  title: string;
  body?: string;
  /** Where a tap goes, e.g. `/downloads`. */
  path: string;
  tag?: string;
}

/** How the pushes to one user's devices went. */
export interface Sent {
  delivered: number;
  gone: number;
  failed: number;
}

export interface PusherOptions {
  sender: PushSender;
  db: Kysely<Database>;
  /** The public origin a notification links to, without a trailing slash. */
  baseUrl: string;
  allowedHosts: readonly string[];
  logger: Logger;
}

export class Pusher {
  readonly allowedHosts: readonly string[];
  private readonly opts: PusherOptions;

  constructor(opts: PusherOptions) {
    this.opts = opts;
    this.allowedHosts = opts.allowedHosts;
  }

  /** The key browsers subscribe with. */
  get publicKey(): string {
    return this.opts.sender.publicKey;
  }

  /** A test notification to one device; a tap opens Settings, where the person turned it on. */
  test(device: DeviceRow): Promise<PushOutcome> {
    const message = {
      title: FALLBACK_TITLE,
      body: "Notifications are on for this device.",
      path: "/settings",
      tag: "uroboros-test",
    };
    return this.sendTo(device, message, "normal");
  }

  /** Sends `message` to every device of `userId`. */
  async notify(userId: string, message: Message, urgency: Urgency): Promise<Sent> {
    const sent: Sent = { delivered: 0, gone: 0, failed: 0 };
    for (const device of await listDevices(this.opts.db, userId)) {
      const outcome = await this.sendTo(device, message, urgency);
      if (outcome.kind === "delivered") sent.delivered += 1;
      else if (outcome.kind === "gone") sent.gone += 1;
      else sent.failed += 1;
    }
    return sent;
  }

  /**
   * One push to one device. A device its push service calls gone is forgotten, and so is one
   * whose stored subscription no longer passes the allowlist; any other failure is recorded.
   */
  async sendTo(device: DeviceRow, message: Message, urgency: Urgency): Promise<PushOutcome> {
    const { db, logger } = this.opts;
    let subscription;
    try {
      subscription = checkSubscription(device, this.allowedHosts);
    } catch (err) {
      if (!(err instanceof SubscriptionError)) throw err;
      logger.warn(
        { device: device.id, reason: err.message },
        "stored push device refused; forgotten",
      );
      await forgetDevice(db, device.id);
      return { kind: "gone", status: 0 };
    }
    const payload = encodePayload(buildPayload({ ...message, navigate: this.link(message.path) }));
    const outcome = await this.opts.sender.send(subscription, payload, urgency);
    if (outcome.kind === "gone") {
      logger.info({ device: device.id, status: outcome.status }, "push device gone; forgotten");
      await forgetDevice(db, device.id);
    } else {
      if (outcome.kind !== "delivered") logger.warn({ device: device.id, outcome }, "push failed");
      await markDevice(db, device.id, outcome.kind === "delivered", new Date());
    }
    return outcome;
  }

  /** An absolute link on the public origin; `path` must start with `/`. */
  link(path: string): string {
    return `${this.opts.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}
