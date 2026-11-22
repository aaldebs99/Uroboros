import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/test/render";

import { storeDevice, storedDevice } from "./stored";
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

function browser(permission: NotificationPermission, existing: object | null) {
  const subscribe = vi.fn(() => Promise.resolve(fresh));
  vi.stubGlobal("Notification", { permission });
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: () => Promise.resolve(existing), subscribe },
      }),
    },
  });
  return subscribe;
}

function server(devices: string[]) {
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
      expect(input).toBe("/api/me/push");
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
});

describe("usePushSync", () => {
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
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
