import { afterEach, describe, expect, it, vi } from "vitest";

import { isInstalled, isIos, STANDALONE } from "./installed";

function displayMode(standalone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === STANDALONE && standalone,
  }));
}

function userAgent(ua: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  // jsdom has no maxTouchPoints.
  Object.defineProperty(navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "standalone");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
});

describe("isInstalled", () => {
  it("is a browser tab until it runs standalone", () => {
    displayMode(false);
    expect(isInstalled()).toBe(false);
    displayMode(true);
    expect(isInstalled()).toBe(true);
  });

  it("is told by iOS's own flag too", () => {
    displayMode(false);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    expect(isInstalled()).toBe(true);
  });
});

describe("isIos", () => {
  it("knows an iPhone", () => {
    userAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15");
    expect(isIos()).toBe(true);
  });

  it("knows an iPad asking for the desktop site by its touch screen", () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5);
    expect(isIos()).toBe(true);
  });

  it("is not a Mac or an Android phone", () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0);
    expect(isIos()).toBe(false);
    userAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0", 5);
    expect(isIos()).toBe(false);
  });
});
