import type { PushSubscriptionBody } from "@uroboros/contract";

/** Whether this browser can be pushed to at all. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The VAPID public key, base64url, as the bytes `subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Subscribes with the server's key; permission must already be granted. */
export async function subscribeWith(publicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
}

/**
 * Asks for permission, then subscribes with the server's key. The prompt needs a tap, so this
 * must run from one. `null` when the person said no.
 */
export async function subscribe(publicKey: string): Promise<PushSubscription | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  return subscribeWith(publicKey);
}

/** What the server is told of a subscription. */
export function bodyOf(subscription: PushSubscription, label: string): PushSubscriptionBody {
  const keys = subscription.toJSON().keys;
  return {
    endpoint: subscription.endpoint,
    p256dh: keys?.["p256dh"] ?? "",
    auth: keys?.["auth"] ?? "",
    label,
  };
}

/** Browser and system names by their user-agent token, most specific first. */
const BROWSERS: [RegExp, string][] = [
  [/Firefox\//, "Firefox"],
  [/Edg\//, "Edge"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

const nameIn = (table: [RegExp, string][], userAgent: string): string | undefined =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

/** A name the person will recognise the device by. */
export function deviceLabel(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }
  if (/Android/.test(userAgent)) return "Android";
  const browser = nameIn(BROWSERS, userAgent) ?? "Browser";
  const system = nameIn(SYSTEMS, userAgent);
  return system ? `${browser} on ${system}` : browser;
}
