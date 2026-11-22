import { describe, expect, it } from "vitest";
import {
  PushDevice,
  PushSubscriptionBody,
  PushTestOutcome,
  PushTestResult,
  PushView,
} from "./index.ts";

const device = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  label: "Firefox on Linux",
  createdAt: "2026-11-21T10:00:00.000Z",
  lastSuccessAt: null,
  failedAt: "2026-11-21T11:00:00.000Z",
};

describe("push contract", () => {
  it("parses a view with a device", () => {
    const view = PushView.parse({
      enabled: true,
      publicKey: "BPub",
      devices: [device],
      maxDevices: 10,
    });
    expect(view.devices[0]?.failedAt).toBe(device.failedAt);
  });

  it("allows a disabled view with no key", () => {
    expect(
      PushView.parse({ enabled: false, publicKey: null, devices: [], maxDevices: 10 }).publicKey,
    ).toBeNull();
  });

  it("rejects a device whose id is not a uuid", () => {
    expect(() => PushDevice.parse({ ...device, id: "nope" })).toThrow();
  });

  it("requires every subscription field", () => {
    const body = { endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth: "a", label: "" };
    expect(PushSubscriptionBody.parse(body)).toEqual(body);
    expect(() => PushSubscriptionBody.parse({ ...body, endpoint: "" })).toThrow();
    expect(() => PushSubscriptionBody.parse({ endpoint: body.endpoint })).toThrow();
  });

  it("has exactly three test outcomes", () => {
    expect(PushTestOutcome.options).toEqual(["delivered", "gone", "failed"]);
    expect(PushTestResult.parse({ outcome: "gone" }).outcome).toBe("gone");
  });
});
