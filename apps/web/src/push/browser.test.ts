import { afterEach, describe, expect, it, vi } from "vitest";

import { bodyOf, deviceLabel, keyBytes, pushSupported } from "./browser";
import { storeDevice, storedDevice } from "./stored";

afterEach(() => {
  localStorage.clear();
});

describe("keyBytes", () => {
  it("decodes unpadded base64url", () => {
    expect(Array.from(keyBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(keyBytes("AQID"))).toEqual([1, 2, 3]);
  });
});

describe("bodyOf", () => {
  it("flattens a subscription with its label", () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/x",
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/x",
        keys: { p256dh: "P", auth: "A" },
      }),
    } as unknown as PushSubscription;
    expect(bodyOf(subscription, "Pixel")).toEqual({
      endpoint: "https://fcm.googleapis.com/x",
      p256dh: "P",
      auth: "A",
      label: "Pixel",
    });
  });
});

describe("deviceLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)", "iPhone"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0", "Android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox on Linux"],
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 Safari/537.36 Edg/140.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.4 Safari/605.1.15",
      "Safari on macOS",
    ],
    ["something else", "Browser"],
  ])("names %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe("pushSupported", () => {
  it("is false where jsdom has no service worker or PushManager", () => {
    expect(pushSupported()).toBe(false);
  });

  it("is true with all three", () => {
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", { permission: "default" });
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    try {
      expect(pushSupported()).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });
});

describe("storedDevice", () => {
  it("round-trips and ignores junk", () => {
    storeDevice({ id: "d1", endpoint: "https://x" });
    expect(storedDevice()).toEqual({ id: "d1", endpoint: "https://x" });
    localStorage.setItem("uroboros.pushDevice", "{");
    expect(storedDevice()).toBeNull();
    storeDevice(null);
    expect(localStorage.getItem("uroboros.pushDevice")).toBeNull();
  });
});
