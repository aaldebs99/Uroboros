import { describe, expect, it } from "vitest";

import { centerCaptions, centerCues } from "./captions";

/** A YouTube caption cue: pinned to the left, wherever its line is. */
const pinned = (line: number | "auto" = "auto") =>
  ({ align: "start", position: 0, size: 100, line }) as unknown as VTTCue;

const trackOf = (cues: VTTCue[]) => ({ cues: cues as unknown as TextTrackCueList }) as TextTrack;

describe("centerCues", () => {
  it("centres cues pinned to one side, keeping their line", () => {
    const cues = [pinned(), pinned(-3)];
    centerCues(trackOf(cues));
    expect(cues.map((c) => [c.align, c.position, c.size, c.line])).toEqual([
      ["center", "auto", 100, "auto"],
      ["center", "auto", 100, -3],
    ]);
  });

  it("does nothing for a track whose cues aren't loaded", () => {
    expect(() => {
      centerCues({ cues: null } as TextTrack);
    }).not.toThrow();
  });
});

describe("centerCaptions", () => {
  /** A <video> with one <track> whose cues load when the test says. */
  function videoWithTrack(loaded: boolean) {
    const video = document.createElement("video");
    const el = document.createElement("track");
    const cues = [pinned()];
    Object.defineProperty(el, "track", { value: trackOf(cues) });
    Object.defineProperty(el, "readyState", { value: loaded ? 2 : 0 });
    video.append(el);
    return { video, el, cues };
  }

  it("centres a track's cues once they load", () => {
    const { video, el, cues } = videoWithTrack(false);
    const stop = centerCaptions(video);
    expect(cues[0]?.align).toBe("start");
    el.dispatchEvent(new Event("load"));
    expect(cues[0]?.align).toBe("center");
    stop();
  });

  it("centres a track that already loaded at once, and stops listening when told", () => {
    const { video, el, cues } = videoWithTrack(true);
    const stop = centerCaptions(video);
    expect(cues[0]?.align).toBe("center");
    stop();
    if (cues[0]) cues[0].align = "start";
    el.dispatchEvent(new Event("load"));
    expect(cues[0]?.align).toBe("start");
  });
});
