import { describe, expect, it } from "vitest";

import { syncAction } from "./sync";

const stored = { id: "d1", endpoint: "https://fcm.googleapis.com/a" };

describe("syncAction", () => {
  it("does nothing for a browser that never turned notifications on", () => {
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "granted",
        endpoint: null,
        stored: null,
        serverDevices: [],
      }),
    ).toBe("none");
  });

  it("forgets the device once permission is gone", () => {
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "denied",
        endpoint: stored.endpoint,
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("forget");
  });

  it("subscribes again when the subscription vanished", () => {
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "granted",
        endpoint: null,
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("resubscribe");
  });

  it("registers again when the endpoint changed or the server forgot the device", () => {
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "granted",
        endpoint: "https://x/b",
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("register");
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "granted",
        endpoint: stored.endpoint,
        stored,
        serverDevices: [],
      }),
    ).toBe("register");
  });

  it("does nothing when all agree", () => {
    expect(
      syncAction({
        turnedOffElsewhere: false,
        permission: "granted",
        endpoint: stored.endpoint,
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("none");
  });

  it("leaves a device turned off from another device off, instead of re-registering it", () => {
    expect(
      syncAction({
        turnedOffElsewhere: true,
        permission: "granted",
        endpoint: stored.endpoint,
        stored,
        serverDevices: [],
      }),
    ).toBe("turnedOff");
  });

  it("still registers a changed endpoint even if the old one was turned off", () => {
    expect(
      syncAction({
        turnedOffElsewhere: true,
        permission: "granted",
        endpoint: "https://x/b",
        stored,
        serverDevices: [],
      }),
    ).toBe("register");
  });
});
