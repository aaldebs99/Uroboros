import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/test/render";

import { storeDevice, storedDevice, turnedOffHere } from "./stored";
import { usePushSync } from "./usePushSync";

const OLD = "0190a3f2-7c1e-7000-8000-0000000000d1";
const NEW = "0190a3f2-7c1e-7000-8000-0000000000d2";
const fresh = {
  endpoint: "https://fcm.googleapis.com/fcm/send/new",
  toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }),
};

function Probe() {
  usePushSync();
  return null;
}

/** How often the hook looked at the browser's subscription: it has begun mending once it has. */
let looks = 0;
/** Requests the fake server had no answer for (asserted after each test, not swallowed). */
const unexpected: string[] = [];

function browser(permission: NotificationPermission, existing: object | null) {
  const subscribe = vi.fn(() => Promise.resolve(fresh));
  vi.stubGlobal("Notification", { permission });
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: () => {
            looks++;
            return Promise.resolve(existing);
          },
          subscribe,
        },
      }),
    },
  });
  return subscribe;
}

function server(devices: string[], turnedOffElsewhere = false) {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(init.body as string));
        return Promise.resolve(
          Response.json({
            id: NEW,
            label: "x",
            createdAt: "2026-11-21T10:00:00.000Z",
            lastSuccessAt: null,
            failedAt: null,
          }),
        );
      }
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/me/push/devices/status?endpoint=")) {
        return Promise.resolve(Response.json({ known: false, turnedOffElsewhere }));
      }
      // An expect here would throw inside fetch, which the hook's catch-all swallows.
      if (url !== "/api/me/push") unexpected.push(url);
      return Promise.resolve(
        Response.json({
          enabled: true,
          publicKey: "AQID",
          maxDevices: 10,
          devices: devices.map((id) => ({
            id,
            label: "x",
            createdAt: "2026-11-21T10:00:00.000Z",
            lastSuccessAt: null,
            failedAt: null,
          })),
        }),
      );
    }),
  );
  return posted;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  localStorage.clear();
  looks = 0;
  expect(unexpected.splice(0)).toEqual([]);
});

describe("usePushSync", () => {
  it("does not turn back on a device that was turned off from another device", async () => {
    const existing = { ...fresh, endpoint: "https://fcm.googleapis.com/fcm/send/kept" };
    storeDevice({ id: OLD, endpoint: existing.endpoint });
    browser("granted", existing);
    const posted = server([], true);
    renderWithQuery(<Probe />);
    await waitFor(() => {
      expect(storedDevice()).toBeNull();
    });
    expect(turnedOffHere()).toBe(true);
    expect(posted).toEqual([]);
  });

  it("re-registers a device the server merely forgot (not turned off)", async () => {
    const existing = { ...fresh, endpoint: "https://fcm.googleapis.com/fcm/send/kept" };
    storeDevice({ id: OLD, endpoint: existing.endpoint });
    browser("granted", existing);
    const posted = server([], false);
    renderWithQuery(<Probe />);
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(turnedOffHere()).toBe(false);
  });

  it("subscribes again and registers when the subscription vanished", async () => {
    storeDevice({ id: OLD, endpoint: "https://fcm.googleapis.com/fcm/send/old" });
    const subscribe = browser("granted", null);
    const posted = server([OLD]);
    renderWithQuery(<Probe />);
    await waitFor(() => {
      expect(storedDevice()).toEqual({ id: NEW, endpoint: fresh.endpoint });
    });
    expect(subscribe).toHaveBeenCalledOnce();
    expect(posted).toEqual([
      { endpoint: fresh.endpoint, p256dh: "P", auth: "A", label: expect.any(String) as string },
    ]);
  });

  it("forgets this browser's device once permission is withdrawn", async () => {
    storeDevice({ id: OLD, endpoint: "https://fcm.googleapis.com/fcm/send/old" });
    browser("denied", null);
    const posted = server([OLD]);
    renderWithQuery(<Probe />);
    await waitFor(() => {
      expect(storedDevice()).toBeNull();
    });
    expect(posted).toEqual([]);
  });

  it("leaves a browser that never turned notifications on alone", async () => {
    const subscribe = browser("granted", null);
    const posted = server([]);
    renderWithQuery(<Probe />);
    // It has read the server's view and looked at the browser's subscription, and decided.
    await waitFor(() => {
      expect(looks).toBe(1);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(subscribe).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
