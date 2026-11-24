import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const skinCss = readFileSync(require.resolve("@videojs/react/video/neutral-skin.css"), "utf8");
/** A file of the packaged skin, in one of the package's two builds. */
const skinFile = (build: "dev" | "default", path: string) =>
  readFileSync(
    join(
      dirname(require.resolve("@videojs/react/video")),
      "../../..",
      build,
      "internal/skins",
      path,
    ),
    "utf8",
  );
const volumePopover = (build: "dev" | "default") =>
  skinFile(build, "neutral-video/components/menus/volume-popover.js");
const gestures = (build: "dev" | "default") =>
  skinFile(build, "shared/skins/shared/video/behaviors/gestures.js");
const settingsMenu = (build: "dev" | "default") =>
  skinFile(build, "neutral-video/skins/shared/video/menus/settings-menu.js");
/** A preset module of the package, in one of its two builds. */
const presetFile = (build: "dev" | "default", name: string) =>
  readFileSync(
    join(
      dirname(require.resolve("@videojs/react/video")),
      "../../..",
      build,
      "presets/video",
      name,
    ),
    "utf8",
  );
const ourCss = readFileSync(resolve(import.meta.dirname, "player.css"), "utf8");
const qualityMenu = readFileSync(resolve(import.meta.dirname, "QualityMenu.tsx"), "utf8");

describe("player.css against the Neutral video skin", () => {
  // player.css styles the timeline through the skin's own class names, which Video.js does not
  // promise to keep. A rename in an upgrade fails here instead of quietly unstyling the player.
  it("targets only class names the shipped skin still has", () => {
    const targeted = [...new Set(ourCss.match(/\.(?:media|video)-[a-z-]+/g) ?? [])];
    expect(targeted.length).toBeGreaterThan(5);
    const missing = targeted.filter((cls) => !skinCss.includes(cls));
    expect(missing).toEqual([]);
  });

  // QualityMenu dresses itself in the skin's menu classes, so it looks like the skin's own.
  it("dresses the Quality menu only in class names the shipped skin still has", () => {
    const used = [...new Set(qualityMenu.match(/media-[a-z-]+/g) ?? [])];
    expect(used.length).toBeGreaterThan(8);
    expect(used.filter((cls) => !skinCss.includes(`.${cls}`))).toEqual([]);
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

  it.each(["dev", "default"] as const)(
    "seeks on a double tap at the sides by touch only, so a mouse double-click is fullscreen (%s build)",
    (build) => {
      for (const region of ["left", "right"]) {
        expect(gestures(build)).toMatch(
          new RegExp(`action: "seekStep",\\s*pointer: "touch",\\s*region: "${region}"`),
        );
      }
    },
  );

  it.each(["dev", "default"] as const)(
    "shows what the settings slot holds in place of the rendition-only Quality menu (%s build)",
    (build) => {
      expect(presetFile(build, "settings-slot.js")).toMatch(
        /const SettingsMenuSlot = createContext\(null\);[\s\S]*export \{ SettingsMenuSlot \}/,
      );
      const menu = settingsMenu(build);
      expect(menu).toContain(
        'import { SettingsMenuSlot } from "../../../../../../../presets/video/settings-slot.js";',
      );
      expect(menu).toMatch(
        /function QualitySlot\(\) \{\s*return useContext\(SettingsMenuSlot\) \?\? \/\* @__PURE__ \*\/ jsx\(QualityMenu, \{\}\);/,
      );
      expect(menu).toContain("t2 = /* @__PURE__ */ jsx(QualitySlot, {});");
    },
  );
});
