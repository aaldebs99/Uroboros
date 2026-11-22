/**
 * A browser's push subscription, checked before anything is ever posted to it. The endpoint is a
 * URL a person handed over, so only `https` on a known push service is taken (SSRF guard), with
 * plain `http` on loopback alone, for tests.
 */

/**
 * The push services browsers subscribe through: Apple's (Safari, iOS), Google's (Chrome, Edge on
 * Android), Mozilla's and Microsoft's. A host matches when it is one of these or a subdomain.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

/** Why a subscription is refused; the message is safe to show the caller. */
export class SubscriptionError extends Error {
  override readonly name = "SubscriptionError";
}

/** A subscription as `PushSubscription.toJSON()` gives it, its keys base64url. */
export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function decode(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/** Whether `hostname` is one of `allowed` or a subdomain of one. */
export function hostAllowed(hostname: string, allowed: readonly string[]): boolean {
  const name = hostname.toLowerCase();
  return allowed.some((entry) => {
    const host = entry.trim().toLowerCase();
    return host !== "" && (name === host || name.endsWith(`.${host}`));
  });
}

function checkEndpoint(endpoint: string, allowed: readonly string[]): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new SubscriptionError("the endpoint is not a URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new SubscriptionError("the endpoint must not carry credentials");
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
  if (!secure) throw new SubscriptionError("the endpoint must be https");
  if (!hostAllowed(url.hostname, allowed)) {
    throw new SubscriptionError(`${url.hostname} is not a push service Uroboros sends to`);
  }
}

/** The subscription, trimmed, when its endpoint is on an allowed host and its keys are sound. */
export function checkSubscription(input: Subscription, allowed: readonly string[]): Subscription {
  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();
  checkEndpoint(endpoint, allowed);
  const key = decode(p256dh);
  if (key?.length !== 65 || key[0] !== 4) {
    throw new SubscriptionError("the p256dh key is not an uncompressed P-256 public key");
  }
  if (decode(auth)?.length !== 16) {
    throw new SubscriptionError("the auth secret is not 16 bytes");
  }
  return { endpoint, p256dh, auth };
}
