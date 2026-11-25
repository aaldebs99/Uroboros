import type { PushDevice, PushView } from "@uroboros/contract";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { markTurnedOffHere, storeDevice, storedDevice, turnedOffHere } from "@/push/stored";
import { renderWithQuery } from "@/test/render";

import { MyNotifications } from "./MyNotifications";

const KEY = "BPmUuOJ4NqvH0v7pXq5o3Q";
const D1 = "0190a3f2-7c1e-7000-8000-0000000000d1";
const D2 = "0190a3f2-7c1e-7000-8000-0000000000d2";
const device = (id: string, label: string, over: Partial<PushDevice> = {}): PushDevice => ({
  id,
  label,
  createdAt: "2026-11-21T10:00:00.000Z",
  lastSuccessAt: null,
  failedAt: null,
  ...over,
});
const view = (over: Partial<PushView> = {}): PushView => ({
  enabled: true,
  publicKey: KEY,
  devices: [],
  maxDevices: 10,
  ...over,
});

type Handler = (init?: RequestInit) => Response;
let routes: Record<string, Handler>;
let calls: string[];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${input as string}`;
      calls.push(key);
      const handler = routes[key];
      return handler
        ? Promise.resolve(handler(init))
        : Promise.reject(new TypeError("fetch failed"));
    }),
  );
}

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }),
};

/** A browser that can be pushed to, with its permission and (optionally) a subscription. */
function pushBrowser(permission: NotificationPermission, existing: object | null = null) {
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>("granted"));
  const subscribe = vi.fn(() => Promise.resolve(subscription));
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", function PushManager() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: () => Promise.resolve(existing), subscribe },
      }),
    },
  });
  return { requestPermission, subscribe };
}

function userAgent(ua: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

function show(v: PushView) {
  routes["GET /api/me/push"] = () => Response.json(v);
  renderWithQuery(
    <>
      <MyNotifications />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  routes = {};
  stubFetch();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  localStorage.clear();
});

describe("MyNotifications", () => {
  it("says when the server does not push, beside a button that can't be pressed", async () => {
    pushBrowser("default");
    show(view({ enabled: false, publicKey: null }));
    const button = await screen.findByRole("button", { name: "Turn on notifications" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/notifications are off on this server/i);
  });

  it("offers to turn notifications on", async () => {
    pushBrowser("default");
    show(view());
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeEnabled();
  });

  it("asks for permission on the tap, subscribes and registers this browser", async () => {
    const { requestPermission, subscribe } = pushBrowser("default");
    routes["POST /api/me/push/devices"] = (init) => {
      expect(JSON.parse(init?.body as string)).toMatchObject({
        endpoint: subscription.endpoint,
        p256dh: "P",
        auth: "A",
      });
      return Response.json(device(D1, "Firefox on Linux"));
    };
    show(view());
    await userEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    await waitFor(() => {
      expect(storedDevice()).toEqual({ id: D1, endpoint: subscription.endpoint });
    });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("says when this browser was turned off from another device, and turns it on here again", async () => {
    pushBrowser("granted");
    markTurnedOffHere(true);
    routes["POST /api/me/push/devices"] = () => Response.json(device(D1, "Firefox on Linux"));
    show(view());
    expect(await screen.findByText("Turned off from another device.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on here" }));
    await waitFor(() => {
      expect(turnedOffHere()).toBe(false);
    });
  });

  it("changes nothing when the person says no", async () => {
    const { requestPermission } = pushBrowser("default");
    requestPermission.mockResolvedValue("denied");
    show(view());
    await userEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    expect(await screen.findByText(/weren't allowed/i)).toBeInTheDocument();
    expect(calls).not.toContain("POST /api/me/push/devices");
  });

  it("tells an iPhone in a Safari tab to install the app first", async () => {
    pushBrowser("default");
    userAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15");
    show(view());
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeDisabled();
  });

  it("says when the browser cannot be pushed to", async () => {
    show(view());
    const button = await screen.findByRole("button", { name: "Turn on notifications" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/can't receive notifications/i);
  });

  it("says when notifications are blocked", async () => {
    pushBrowser("denied");
    show(view());
    expect(await screen.findByText(/blocked for Uroboros/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeDisabled();
  });

  it("lists devices, marks this one, and offers no second turn-on", async () => {
    pushBrowser("granted", subscription);
    storeDevice({ id: D1, endpoint: subscription.endpoint });
    show(
      view({
        devices: [
          device(D1, "Firefox on Linux"),
          device(D2, "iPhone", { failedAt: "2026-11-21T12:00:00.000Z" }),
        ],
      }),
    );
    const list = await screen.findByRole("list", { name: "Devices with notifications" });
    expect(list).toHaveTextContent("Firefox on Linux");
    expect(list).toHaveTextContent("this device");
    expect(list).toHaveTextContent(/last push failed/);
    expect(
      screen.queryByRole("button", { name: /turn on notifications/i }),
    ).not.toBeInTheDocument();
  });

  it("sends a test and says how it went", async () => {
    pushBrowser("granted");
    routes[`POST /api/me/push/devices/${D2}/test`] = () => Response.json({ outcome: "delivered" });
    show(view({ devices: [device(D2, "iPhone")] }));
    await userEvent.click(await screen.findByRole("button", { name: "Send test to iPhone" }));
    expect(await screen.findByText(/iPhone: sent/i)).toBeInTheDocument();
  });

  it("turns a device off", async () => {
    pushBrowser("granted");
    storeDevice({ id: D1, endpoint: subscription.endpoint });
    routes[`DELETE /api/me/push/devices/${D1}`] = () => new Response(null, { status: 204 });
    show(view({ devices: [device(D1, "Pixel")] }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn off Pixel" }));
    await waitFor(() => {
      expect(calls).toContain(`DELETE /api/me/push/devices/${D1}`);
    });
    await waitFor(() => {
      expect(storedDevice()).toBeNull();
    });
  });

  it("says when the devices could not be loaded, with a retry", async () => {
    pushBrowser("default");
    renderWithQuery(<MyNotifications />);
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
