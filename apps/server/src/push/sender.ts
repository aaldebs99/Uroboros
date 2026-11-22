/**
 * One push, posted to the browser's push service (RFC 8030): the payload encrypted as RFC 8291
 * `aes128gcm` for that browser alone and signed for with the deployment's VAPID key (RFC 8292),
 * both by the `web-push` package. The request itself is ours, through `fetch`, so redirects are
 * never followed and the time limit holds for the whole exchange.
 */
import { generateRequestDetails } from "web-push";
import type { Subscription } from "./endpoint.ts";

/** How long a push service may hold a push for an unreachable device. */
export const DEFAULT_TTL_SECONDS = 86_400;
/** The longest `Retry-After` a push waits out before its one retry. */
const MAX_RETRY_WAIT_MS = 5_000;
/** Each request's time limit. */
const REQUEST_TIMEOUT_MS = 15_000;

/** RFC 8030 `Urgency`: `normal` for tests and routine news, `high` for failures. */
export type Urgency = "normal" | "high";

/** How one push went. */
export type PushOutcome =
  | { kind: "delivered" }
  /** 404 or 410: the subscription is gone, forget the device. */
  | { kind: "gone"; status: number }
  /** The push service refused it for another reason. */
  | { kind: "rejected"; status: number }
  /** It never reached the push service, could not be built, or the service stayed busy. */
  | { kind: "failed"; error: string };

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface SenderOptions {
  vapid: VapidKeys;
  /** A `mailto:` or `https:` contact the push services can reach about these pushes. */
  subject: string;
  ttlSeconds?: number;
  timeoutMs?: number;
  /** Tests replace the wait before a retry. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PushSender {
  /** The VAPID public key, base64url, for browsers to subscribe with. */
  readonly publicKey: string;
  send(subscription: Subscription, payload: string, urgency: Urgency): Promise<PushOutcome>;
}

type Posted = { done: PushOutcome } | { again: number; status: number };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds in a `Retry-After`, as milliseconds, when it is short enough to wait out. */
function retryWait(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  const ms = Number(header.trim()) * 1000;
  return ms <= MAX_RETRY_WAIT_MS ? ms : null;
}

function outcomeOf(res: Response): Posted {
  if (res.ok) return { done: { kind: "delivered" } };
  if (res.status === 404 || res.status === 410) {
    return { done: { kind: "gone", status: res.status } };
  }
  const busy = res.status === 429 || res.status >= 500;
  const again = busy ? retryWait(res.headers.get("retry-after")) : null;
  return again === null
    ? { done: { kind: "rejected", status: res.status } }
    : { again, status: res.status };
}

function headersOf(details: ReturnType<typeof generateRequestDetails>): Headers {
  const headers = new Headers();
  // Typed as strings, but TTL and Content-Length arrive as numbers.
  for (const [name, value] of Object.entries(details.headers as Record<string, unknown>)) {
    // fetch computes Content-Length from the body itself.
    if (name.toLowerCase() !== "content-length") headers.set(name, String(value));
  }
  return headers;
}

export function createPushSender(opts: SenderOptions): PushSender {
  const sleep = opts.sleep ?? wait;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post(subscription: Subscription, payload: string, urgency: Urgency) {
    const details = generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      {
        vapidDetails: { subject: opts.subject, ...opts.vapid },
        TTL: opts.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        urgency,
        contentEncoding: "aes128gcm",
      },
    );
    const res = await fetch(details.endpoint, {
      method: "POST",
      headers: headersOf(details),
      body: new Uint8Array(details.body),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return outcomeOf(res);
  }

  async function send(subscription: Subscription, payload: string, urgency: Urgency) {
    try {
      const first = await post(subscription, payload, urgency);
      if ("done" in first) return first.done;
      await sleep(first.again);
      const second = await post(subscription, payload, urgency);
      if ("done" in second) return second.done;
      return {
        kind: "failed",
        error: `the push service is busy (${String(second.status)})`,
      } as const;
    } catch (err) {
      return { kind: "failed", error: err instanceof Error ? err.message : String(err) } as const;
    }
  }

  return { publicKey: opts.vapid.publicKey, send };
}
