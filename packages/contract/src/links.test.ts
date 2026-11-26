import { describe, expect, it } from "vitest";
import { WebLink, withScheme } from "./index.ts";

describe("WebLink", () => {
  it.each([
    ["twitch.tv/channel", "https://twitch.tv/channel"],
    ["  twitch.tv/x  ", "https://twitch.tv/x"],
    ["www.twitch.tv", "https://www.twitch.tv"],
    ["//twitch.tv/x", "https://twitch.tv/x"],
    ["localhost:8080/x", "https://localhost:8080/x"],
    ["youtube.com/watch?v=a", "https://youtube.com/watch?v=a"],
  ])("reads %j as %j", (typed, link) => {
    expect(WebLink.parse(typed)).toBe(link);
  });

  it.each(["http://x.com/v", "HTTPS://X.com/a", "https://www.youtube.com/watch?v=a"])(
    "keeps %j as it is",
    (link) => {
      expect(WebLink.parse(link)).toBe(link);
    },
  );

  it.each([
    "ftp://x.org/v",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:a@b.c",
    "",
    "   ",
    "not a link",
    `https://x.org/${"a".repeat(2035)}`,
  ])("refuses %j", (typed) => {
    expect(WebLink.safeParse(typed).success).toBe(false);
  });

  it("counts the 2048 characters with the scheme it adds", () => {
    const path = "a".repeat(2048 - "https://x.org/".length);
    expect(WebLink.safeParse(`x.org/${path}`).success).toBe(true);
    expect(WebLink.safeParse(`x.org/${path}a`).success).toBe(false);
  });
});

describe("withScheme", () => {
  it("leaves a link with a scheme alone, whatever the scheme", () => {
    expect(withScheme("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(withScheme("http://x.org")).toBe("http://x.org");
  });

  it("takes a host and port for a link without a scheme", () => {
    expect(withScheme("nas:8096")).toBe("https://nas:8096");
    expect(withScheme("nas:8096?a=1")).toBe("https://nas:8096?a=1");
  });
});
