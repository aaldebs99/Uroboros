import { describe, expect, it } from "vitest";

import { originOf, platformName } from "./platform.ts";

describe("platformName", () => {
  it.each([
    ["youtube", "https://www.youtube.com/watch?v=a", "YouTube"],
    ["vimeo", "https://vimeo.com/753580183", "Vimeo"],
    ["twitchvod", null, "Twitch"],
    ["soundcloud", "https://soundcloud.com/a/b", "SoundCloud"],
    ["twitter", "https://x.com/a/status/1", "X"],
  ])("names a well-known site by its extractor (%s)", (extractor, url, name) => {
    expect(platformName(extractor, url)).toBe(name);
  });

  it("names any other site, a direct link included, by its page's host", () => {
    expect(platformName("generic", "https://www.example.com/clip.mp4")).toBe("example.com");
    expect(platformName("rutube", "https://rutube.ru/video/1/")).toBe("rutube.ru");
  });

  it("falls back to the extractor itself without a usable page address", () => {
    expect(platformName("rutube", null)).toBe("Rutube");
    expect(platformName("generic", "not a url")).toBe("Generic");
    expect(platformName("", null)).toBe("Unknown site");
  });
});

describe("uploads", () => {
  it("are named Uploads, and only the upload extractor is an upload", () => {
    expect(platformName("upload", null)).toBe("Uploads");
    expect(originOf("upload")).toBe("upload");
    expect(originOf("youtube")).toBe("download");
    expect(originOf("uploadsite")).toBe("download");
  });
});
