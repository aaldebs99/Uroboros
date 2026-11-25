import type { PushView } from "@uroboros/contract";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePush } from "@/api/push";
import { Toaster } from "@/components/ui/sonner";
import { renderWithQuery } from "@/test/render";

import { STANDALONE } from "./installed";
import { PushNudge } from "./PushNudge";
import { storedDevice } from "./stored";

const D1 = "0190a3f2-7c1e-7000-8000-0000000000d1";
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }),
};
const view = (over: Partial<PushView> = {}): PushView => ({
  enabled: true,
  publicKey: "BPmUuOJ4NqvH0v7pXq5o3Q",
  devices: [],
  maxDevices: 10,
  ...over,
});

let push: PushView;
let posted: number;

/** A browser that can be pushed to, opened as the installed app or in a tab. */
function browser(permission: NotificationPermission, { installed = true } = {}) {
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>("granted"));
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: installed && query === STANDALONE,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: () => Promise.resolve(null),
          subscribe: () => Promise.resolve(subscription),
        },
      }),
    },
  });
  return requestPermission;
}

/** Shows once the push settings are in, when the banner has decided too (one query, one render). */
function Loaded() {
  return usePush().data ? <p>loaded</p> : null;
}

async function show() {
  const result = renderWithQuery(
    <>
      <PushNudge />
      <Loaded />
      <Toaster />
    </>,
  );
  await screen.findByText("loaded");
  return result;
}

const noBanner = () => {
  expect(screen.queryByText("Get notified when downloads finish")).not.toBeInTheDocument();
};

const banner = () => screen.findByText("Get notified when downloads finish");

beforeEach(() => {
  push = view();
  posted = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && input === "/api/me/push/devices") {
        posted += 1;
        return Promise.resolve(
          Response.json({
            id: D1,
            label: "Firefox on Linux",
            createdAt: "2026-11-21T10:00:00.000Z",
            lastSuccessAt: null,
            failedAt: null,
          }),
        );
      }
      if (input === "/api/me/push") return Promise.resolve(Response.json(push));
      return Promise.reject(new TypeError("fetch failed"));
    }),
  );
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  localStorage.clear();
});

describe("PushNudge", () => {
  it("offers the installed app notifications, and Turn on asks, registers and says so", async () => {
    const requestPermission = browser("default");
    const { unmount } = await show();
    expect(await banner()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("Notifications are on for this device.")).toBeInTheDocument();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(posted).toBe(1);
    expect(storedDevice()).toEqual({ id: D1, endpoint: subscription.endpoint });
    noBanner();
    unmount();
    await show();
    noBanner();
  });

  it("goes away for good on Not now, without asking the browser", async () => {
    const requestPermission = browser("default");
    const { unmount } = await show();
    expect(await banner()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    noBanner();
    expect(requestPermission).not.toHaveBeenCalled();
    unmount();
    await show();
    noBanner();
  });

  it.each([
    ["in a browser tab", "default", { installed: false }, {}],
    ["once notifications are allowed", "granted", {}, {}],
    ["once notifications are blocked", "denied", {}, {}],
    ["when the server doesn't push", "default", {}, { enabled: false, publicKey: null }],
  ] as const)("says nothing %s", async (_, permission, opts, server) => {
    browser(permission, opts);
    push = view(server);
    await show();
    noBanner();
  });
});
