import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSubtitleLang,
  readVolume,
  storeSubtitleLang,
  storeVolume,
  SUBTITLES_KEY,
  VOLUME_KEY,
} from "./playerPrefs";

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

describe("player subtitle preference", () => {
  it("is off until a language is saved, and off again once cleared", () => {
    expect(readSubtitleLang()).toBeNull();
    storeSubtitleLang("fr");
    expect(readSubtitleLang()).toBe("fr");
    storeSubtitleLang(null);
    expect(readSubtitleLang()).toBeNull();
    expect(localStorage.getItem(SUBTITLES_KEY)).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readSubtitleLang()).toBeNull();
    expect(() => {
      storeSubtitleLang("fr");
      storeSubtitleLang(null);
    }).not.toThrow();
  });
});
