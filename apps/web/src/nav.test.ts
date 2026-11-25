import { describe, expect, it } from "vitest";

import { isWatchPage } from "./nav";

describe("isWatchPage", () => {
  it.each([
    ["/library/0190a3f2-7c1e-7000-8000-000000000200", true],
    ["/library/0190a3f2-7c1e-7000-8000-000000000200/", true],
    ["/library/audio", false],
    ["/library/channels", false],
    ["/library/playlists", false],
    ["/library/channels/Blender", false],
    ["/library/playlists/0190a3f2-7c1e-7000-8000-000000000300", false],
    ["/", false],
    ["/downloads", false],
  ])("%s is %s", (pathname, expected) => {
    expect(isWatchPage(pathname)).toBe(expected);
  });
});
