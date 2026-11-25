import { act, render } from "@testing-library/react";
import type { SubtitleTrack } from "@uroboros/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSubtitleLang, storeSubtitleLang } from "@/lib/playerPrefs";
import { withTextTracks } from "@/test/textTracks";

import { Player } from "./Player";

const noop = () => undefined;

const base = {
  src: "/v",
  title: "t",
  start: 0,
  autoPlay: false,
  seek: null,
  chapters: [],
  onTime: noop,
  onPause: noop,
  onEnded: noop,
};

const sub = (lang: string, n: number): SubtitleTrack => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  lang,
  name: null,
  automatic: false,
  url: `/s/${lang}.vtt`,
});
const enFr = [sub("en", 1), sub("fr", 2)];

function renderWith(subtitles: SubtitleTrack[]) {
  const { container } = render(<Player {...base} subtitles={subtitles} />);
  const video = container.querySelector("video") as HTMLVideoElement;
  const byLang = (lang: string) => {
    const el = container.querySelector<HTMLTrackElement>(`track[srclang="${lang}"]`);
    if (el === null) throw new Error(`no ${lang} track`);
    return el;
  };
  const changed = () => {
    act(() => {
      video.textTracks.dispatchEvent(new Event("change"));
    });
  };
  return { byLang, changed };
}

describe("Player subtitles", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withTextTracks();
  });
  afterEach(() => {
    restore();
    localStorage.clear();
  });

  it("keeps subtitles off when nothing is remembered", () => {
    const { byLang } = renderWith(enFr);
    for (const lang of ["en", "fr"]) {
      expect(byLang(lang).track.mode).toBe("disabled");
      expect(byLang(lang).hasAttribute("default")).toBe(false);
    }
  });

  it("turns on the remembered language", () => {
    storeSubtitleLang("fr");
    const { byLang } = renderWith(enFr);
    expect(byLang("fr").track.mode).toBe("showing");
    expect(byLang("en").track.mode).toBe("disabled");
  });

  it("remembers the language turned on, and that they were turned off", () => {
    const { byLang, changed } = renderWith(enFr);
    byLang("fr").track.mode = "showing";
    changed();
    expect(readSubtitleLang()).toBe("fr");
    byLang("fr").track.mode = "disabled";
    changed();
    expect(readSubtitleLang()).toBeNull();
  });

  it("keeps the remembered language when a video lacks it and shows another", () => {
    storeSubtitleLang("de");
    const { byLang, changed } = renderWith(enFr);
    expect(byLang("en").track.mode).toBe("showing");
    changed();
    expect(readSubtitleLang()).toBe("de");
    // Once the viewer picks for themselves, their pick is remembered.
    byLang("en").track.mode = "disabled";
    changed();
    byLang("en").track.mode = "showing";
    changed();
    expect(readSubtitleLang()).toBe("en");
  });

  it("leaves the remembered language alone on a video without subtitles", () => {
    storeSubtitleLang("fr");
    const { changed } = renderWith([]);
    changed();
    expect(readSubtitleLang()).toBe("fr");
  });
});
