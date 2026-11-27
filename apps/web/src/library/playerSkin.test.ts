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
const timeSlider = (build: "dev" | "default") =>
  skinFile(build, "neutral-video/components/sliders/time-slider.js");
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

  // Captions are turned on and off from the settings menu's Captions submenu alone, so the control
  // bar has no button of its own for them.
  it("hides the skin's own captions button", () => {
    expect(ourCss).toMatch(
      /\.uro-player \.video-controls-captions-button \{\s*display: none;\s*\}/,
    );
  });

  // On phones the player runs edge to edge (WatchPlayer), so its corners are square there: the
  // skin rounds itself through this variable, which a rename would quietly bring back.
  /** Our phone-only rules for the player: the body of `@media (width < 48rem) { .uro-player { … } }`. */
  const phoneRules = () =>
    /@media \(width < 48rem\) \{\s*\.uro-player \{([^}]*)\}\s*\}/.exec(ourCss)?.[1] ?? "";

  it("squares the player's corners below md, through the variable the skin rounds it with", () => {
    expect(skinCss).toMatch(
      /\.media-container[^{]*\{[^}]*border-radius: var\(--media-video-border-radius\)/,
    );
    expect(phoneRules()).toMatch(/--media-video-border-radius: 0;/);
  });

  // On phones a play/pause button sits over the middle of the picture, coming and going with the
  // controls: the skin's own center play button, which it hides once playback starts through these
  // two variables.
  it("keeps the skin's center play button once playing, below md", () => {
    expect(skinCss).toMatch(
      /\.video-controls-center-play\[data-started\][^{]*\{[^}]*pointer-events: var\(--media-center-play-started-pointer-events, none\)[^}]*opacity: var\(--media-center-play-started-opacity, 0\)/,
    );
    expect(phoneRules()).toMatch(/--media-center-play-started-opacity: 1;/);
    expect(phoneRules()).toMatch(/--media-center-play-started-pointer-events: auto;/);
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

  it.each(["dev", "default"] as const)(
    "draws the SponsorBlock segments' track (label \"skip\") as markers on the timeline, marking skipped ones and each one's category (%s build)",
    (build) => {
      const slider = timeSlider(build);
      expect(slider).toContain(
        'import { TimeSliderMarkers } from "../../../../../ui/time-slider/markers.js";',
      );
      expect(slider).toContain('const uroSkipFilter = { label: "skip" };');
      expect(slider).toMatch(/className: "uro-skip-markers",\s*filter: uroSkipFilter,/);
      // A band playback jumps (cue id "skip:…") is marked; a shown-only one ("show:…") and the
      // highlight ("point:…") aren't. The id's second part, the category, picks the color.
      expect(slider).toContain('"data-skips": marker.cue.id.startsWith("skip:") ? "" : void 0');
      expect(slider).toContain('"data-category": marker.cue.id.split(":")[1]');
      expect(slider).toMatch(
        /children: \[\s*t4,\s*uroSkipMarkers,\s*uroTimeSliderSlot,\s*t5,\s*t11\s*\]/,
      );
    },
  );

  it.each(["dev", "default"] as const)(
    "makes the time slider slot, empty by default (%s build)",
    (build) => {
      expect(presetFile(build, "time-slider-slot.js")).toMatch(
        /const TimeSliderSlot = createContext\(null\);[\s\S]*export \{ TimeSliderSlot \}/,
      );
    },
  );

  it.each(["dev", "default"] as const)(
    "draws what the time slider slot holds over the SponsorBlock marks, under the thumb (%s build)",
    (build) => {
      const slider = timeSlider(build);
      expect(slider).toContain(
        'import { TimeSliderSlot } from "../../../../../presets/video/time-slider-slot.js";',
      );
      expect(slider).toMatch(
        /function TimeSliderSlotOutlet\(\) \{\s*return useContext\(TimeSliderSlot\);/,
      );
    },
  );
});
