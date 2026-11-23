import { afterEach, describe, expect, it, vi } from "vitest";

import { readVolume, storeVolume, VOLUME_KEY } from "./playerPrefs";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("player volume preference", () => {
  it("round-trips the volume and mute", () => {
    storeVolume({ volume: 0.35, muted: true });
    expect(readVolume()).toEqual({ volume: 0.35, muted: true });
  });

  it("is null when nothing is saved, and ignores junk", () => {
    expect(readVolume()).toBeNull();
    for (const junk of ["not json", '{"volume":2,"muted":false}', '{"volume":0.5}', "null"]) {
      localStorage.setItem(VOLUME_KEY, junk);
      expect(readVolume()).toBeNull();
    }
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readVolume()).toBeNull();
    expect(() => {
      storeVolume({ volume: 1, muted: false });
    }).not.toThrow();
  });
});
