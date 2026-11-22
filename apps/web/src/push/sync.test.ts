import { describe, expect, it } from "vitest";

import { syncAction } from "./sync";

const stored = { id: "d1", endpoint: "https://fcm.googleapis.com/a" };

describe("syncAction", () => {
  it("does nothing for a browser that never turned notifications on", () => {
    expect(
      syncAction({ permission: "granted", endpoint: null, stored: null, serverDevices: [] }),
    ).toBe("none");
  });

  it("forgets the device once permission is gone", () => {
    expect(
      syncAction({
        permission: "denied",
        endpoint: stored.endpoint,
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("forget");
  });

  it("subscribes again when the subscription vanished", () => {
    expect(
      syncAction({ permission: "granted", endpoint: null, stored, serverDevices: ["d1"] }),
    ).toBe("resubscribe");
  });

  it("registers again when the endpoint changed or the server forgot the device", () => {
    expect(
      syncAction({ permission: "granted", endpoint: "https://x/b", stored, serverDevices: ["d1"] }),
    ).toBe("register");
    expect(
      syncAction({ permission: "granted", endpoint: stored.endpoint, stored, serverDevices: [] }),
    ).toBe("register");
  });

  it("does nothing when all agree", () => {
    expect(
      syncAction({
        permission: "granted",
        endpoint: stored.endpoint,
        stored,
        serverDevices: ["d1"],
      }),
    ).toBe("none");
  });
});
