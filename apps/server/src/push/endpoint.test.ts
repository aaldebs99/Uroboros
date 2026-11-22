import { describe, expect, it } from "vitest";
import { browserKeys } from "../../test/pushStub.ts";
import { checkSubscription, DEFAULT_ALLOWED_HOSTS, SubscriptionError } from "./endpoint.ts";

const keys = browserKeys();
const sub = (endpoint: string, over: { p256dh?: string; auth?: string } = {}) => ({
  endpoint,
  p256dh: over.p256dh ?? keys.p256dh,
  auth: over.auth ?? keys.auth,
});
const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof SubscriptionError) return err.message;
    throw err;
  }
  throw new Error("expected a SubscriptionError");
};

describe("checkSubscription", () => {
  it.each([
    "https://web.push.apple.com/QGuQyavXutnMH4",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-bl2p.notify.windows.com/w/?token=abc",
  ])("takes the known push service %s", (endpoint) => {
    expect(checkSubscription(sub(endpoint), DEFAULT_ALLOWED_HOSTS).endpoint).toBe(endpoint);
  });

  it("refuses hosts that only look like a push service", () => {
    expect(
      reason(() =>
        checkSubscription(sub("https://evil.example/push.apple.com"), DEFAULT_ALLOWED_HOSTS),
      ),
    ).toMatch(/evil\.example is not a push service/);
    expect(
      reason(() =>
        checkSubscription(sub("https://notpush.apple.com.evil.example/x"), DEFAULT_ALLOWED_HOSTS),
      ),
    ).toMatch(/not a push service/);
    expect(
      reason(() => checkSubscription(sub("https://xpush.apple.com/x"), DEFAULT_ALLOWED_HOSTS)),
    ).toMatch(/not a push service/);
  });

  it("refuses plain http except on loopback", () => {
    expect(
      reason(() => checkSubscription(sub("http://web.push.apple.com/x"), DEFAULT_ALLOWED_HOSTS)),
    ).toMatch(/https/);
    expect(checkSubscription(sub("http://127.0.0.1:9/push"), ["127.0.0.1"]).endpoint).toBe(
      "http://127.0.0.1:9/push",
    );
    expect(reason(() => checkSubscription(sub("http://10.0.0.1/push"), ["10.0.0.1"]))).toMatch(
      /https/,
    );
  });

  it("refuses what is not a URL, or carries credentials", () => {
    expect(reason(() => checkSubscription(sub("not a url"), DEFAULT_ALLOWED_HOSTS))).toMatch(
      /not a URL/,
    );
    expect(
      reason(() =>
        checkSubscription(sub("https://u:p@fcm.googleapis.com/x"), DEFAULT_ALLOWED_HOSTS),
      ),
    ).toMatch(/credentials/);
  });

  it("checks the key shapes", () => {
    const endpoint = "https://fcm.googleapis.com/x";
    expect(
      reason(() => checkSubscription(sub(endpoint, { p256dh: keys.auth }), DEFAULT_ALLOWED_HOSTS)),
    ).toMatch(/p256dh/);
    expect(
      reason(() => checkSubscription(sub(endpoint, { auth: keys.p256dh }), DEFAULT_ALLOWED_HOSTS)),
    ).toMatch(/auth/);
    expect(
      reason(() => checkSubscription(sub(endpoint, { auth: "!!" }), DEFAULT_ALLOWED_HOSTS)),
    ).toMatch(/auth/);
  });

  it("trims what it keeps", () => {
    const out = checkSubscription(
      {
        endpoint: " https://fcm.googleapis.com/x ",
        p256dh: ` ${keys.p256dh}`,
        auth: `${keys.auth} `,
      },
      DEFAULT_ALLOWED_HOSTS,
    );
    expect(out).toEqual(sub("https://fcm.googleapis.com/x"));
  });

  it("matches allowed hosts case-insensitively", () => {
    expect(
      checkSubscription(sub("https://FCM.googleapis.com/x"), [" FCM.GoogleAPIs.com "]).endpoint,
    ).toBe("https://FCM.googleapis.com/x");
  });
});
