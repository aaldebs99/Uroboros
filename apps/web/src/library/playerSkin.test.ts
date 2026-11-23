import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const skinCss = readFileSync(require.resolve("@videojs/react/video/neutral-skin.css"), "utf8");
/** The packaged skin's volume popover, in one of the package's two builds. */
const volumePopover = (build: "dev" | "default") =>
  readFileSync(
    join(
      dirname(require.resolve("@videojs/react/video")),
      "../../..",
      build,
      "internal/skins/neutral-video/components/menus/volume-popover.js",
    ),
    "utf8",
  );
const ourCss = readFileSync(resolve(import.meta.dirname, "player.css"), "utf8");

describe("player.css against the Neutral video skin", () => {
  // player.css styles the timeline through the skin's own class names, which Video.js does not
  // promise to keep. A rename in an upgrade fails here instead of quietly unstyling the player.
  it("targets only class names the shipped skin still has", () => {
    const targeted = [...new Set(ourCss.match(/\.(?:media|video)-[a-z-]+/g) ?? [])];
    expect(targeted.length).toBeGreaterThan(5);
    const missing = targeted.filter((cls) => !skinCss.includes(cls));
    expect(missing).toEqual([]);
  });
});

describe("patches/@videojs__react.patch", () => {
  // pnpm applies it on install (patchedDependencies); this proves the installed skin has it.
  it.each(["dev", "default"] as const)(
    "opens the volume slider as soon as the pointer reaches the mute button (%s build)",
    (build) => {
      expect(volumePopover(build)).toMatch(/openOnHover: true,\s*delay: 0,/);
    },
  );
});
