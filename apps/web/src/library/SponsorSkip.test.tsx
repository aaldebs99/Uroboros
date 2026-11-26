import { act, fireEvent, render, within } from "@testing-library/react";
import type { SponsorSegment } from "@uroboros/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";

import { Player } from "./Player";

const noop = () => undefined;

/** Overrides a media element getter on the prototype; returns its undo. */
function stub(name: "paused" | "seeking" | "duration", get: () => unknown): () => void {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name);
  Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, get });
  return () => {
    if (desc) Object.defineProperty(HTMLMediaElement.prototype, name, desc);
  };
}

let paused = false;
let restore: (() => void)[] = [];
beforeEach(() => {
  paused = false;
  restore = [
    stub("paused", () => paused),
    stub("seeking", () => false),
    stub("duration", () => 1008),
  ];
});
afterEach(() => {
  for (const r of restore) r();
});

const DEFAULT_SEGMENTS: SponsorSegment[] = [
  { start: 77.694, end: 88.43, category: "selfpromo", show: true, skip: true },
  { start: 49.04, end: 69, category: "sponsor", show: true, skip: true },
  { start: 77.75, end: 88.45, category: "sponsor", show: true, skip: true },
  { start: 990, end: 1008, category: "sponsor", show: true, skip: true },
];

function renderPlayer(segments: SponsorSegment[] = DEFAULT_SEGMENTS) {
  const { container } = render(
    <>
      <Player
        src="/v"
        title="t"
        start={0}
        autoPlay={false}
        seek={null}
        chapters={[]}
        sponsorSegments={segments}
        subtitles={[]}
        onTime={noop}
        onPause={noop}
        onEnded={noop}
      />
      <Toaster />
    </>,
  );
  const video = container.querySelector("video") as HTMLVideoElement;
  const player = container.querySelector(".uro-player") as HTMLElement;
  /** The player's own notice of what it skipped (not a page toast). */
  const notice = () => within(player).getByRole("status", { name: "SponsorBlock" });
  /** Playback moving on to `t` (a `timeupdate`). */
  const playTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("timeupdate"));
  };
  /** The viewer seeking to `t` (jsdom fires no `seeked` itself). */
  const seekTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("seeked"));
  };
  return { video, notice, playTo, seekTo };
}

describe("SponsorSkip", () => {
  it("jumps over a segment playback runs into, saying so in the player rather than a toast, and a seek back watches it", async () => {
    const { video, notice, playTo, seekTo } = renderPlayer();
    seekTo(48);
    playTo(48.5);
    expect(video.currentTime).toBe(48.5);
    expect(notice()).toHaveTextContent("");
    playTo(49.1);
    expect(video.currentTime).toBe(69);
    expect(notice()).toHaveTextContent("Skipped sponsor");
    // Long enough for a toast to have rendered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    // Seeking back to its start plays the segment through.
    seekTo(49.04);
    playTo(49.3);
    playTo(50);
    expect(video.currentTime).toBe(50);
  });

  it("lets a segment the viewer seeks into play out", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(55);
    playTo(55.25);
    playTo(55.5);
    playTo(56.5);
    expect(video.currentTime).toBe(56.5);
  });

  it("skips a segment playback reaches after a seek to just before it", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(55);
    playTo(55.25);
    seekTo(76.9);
    playTo(77.2);
    playTo(77.8);
    expect(video.currentTime).toBe(88.45);
  });

  it("jumps over overlapping segments at once", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(77.5);
    playTo(77.8);
    expect(video.currentTime).toBe(88.45);
  });

  it("goes to the end for a segment that runs to it, and skips nothing while paused", () => {
    const { video, playTo, seekTo } = renderPlayer();
    paused = true;
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(49.2);
    paused = false;
    seekTo(989.5);
    playTo(990.2);
    expect(video.currentTime).toBe(1008);
  });

  it("does not jump over a segment that is shown but not skipped", () => {
    const { video, playTo, seekTo } = renderPlayer([
      { start: 49.04, end: 69, category: "intro", show: true, skip: false },
    ]);
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(49.2);
  });

  it("jumps over a segment that is skipped but not shown", () => {
    const { video, playTo, seekTo } = renderPlayer([
      { start: 49.04, end: 69, category: "filler", show: false, skip: true },
    ]);
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(69);
  });

  it("goes back and plays a segment through when the notice is pressed, and never skips it again in this view", () => {
    const { video, notice, playTo, seekTo } = renderPlayer();
    seekTo(48);
    playTo(48.5);
    playTo(49.1);
    expect(video.currentTime).toBe(69);
    fireEvent.click(within(notice()).getByRole("button", { name: "Skipped sponsor Unskip" }));
    expect(video.currentTime).toBe(49.04);
    expect(notice()).toHaveTextContent("");
    playTo(49.3);
    playTo(50);
    expect(video.currentTime).toBe(50);
    // Played into again from before it, it plays.
    seekTo(48);
    playTo(48.5);
    playTo(49.1);
    expect(video.currentTime).toBe(49.1);
  });

  it("names every category of overlapping segments it jumped at once", () => {
    const { notice, playTo, seekTo } = renderPlayer();
    seekTo(77.5);
    playTo(77.8);
    expect(notice()).toHaveTextContent("Skipped self-promotion and sponsor");
  });
});

describe("the skip notice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const wait = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it("leaves 4 s after the skip", () => {
    const { notice, playTo, seekTo } = renderPlayer();
    seekTo(48.5);
    playTo(49.1);
    wait(3999);
    expect(notice()).toHaveTextContent("Skipped sponsor");
    wait(1);
    expect(notice()).toHaveTextContent("");
  });

  it("stays while the pointer is on it, then leaves 4 s after it goes", () => {
    const { notice, playTo, seekTo } = renderPlayer();
    seekTo(48.5);
    playTo(49.1);
    const unskip = within(notice()).getByRole("button", { name: "Skipped sponsor Unskip" });
    fireEvent.pointerEnter(unskip);
    wait(10_000);
    expect(notice()).toHaveTextContent("Skipped sponsor");
    fireEvent.pointerLeave(unskip);
    wait(3999);
    expect(notice()).toHaveTextContent("Skipped sponsor");
    wait(1);
    expect(notice()).toHaveTextContent("");
  });

  it("stays while it has the focus", () => {
    const { notice, playTo, seekTo } = renderPlayer();
    seekTo(48.5);
    playTo(49.1);
    act(() => {
      within(notice()).getByRole("button", { name: "Skipped sponsor Unskip" }).focus();
    });
    wait(10_000);
    expect(notice()).toHaveTextContent("Skipped sponsor");
  });

  it("gives way to the next skip, which gets its own 4 s", () => {
    const { notice, playTo, seekTo } = renderPlayer();
    seekTo(48.5);
    playTo(49.1);
    wait(3000);
    seekTo(77.5);
    playTo(77.8);
    expect(notice()).toHaveTextContent("Skipped self-promotion and sponsor");
    wait(3999);
    expect(notice()).toHaveTextContent("Skipped self-promotion and sponsor");
    wait(1);
    expect(notice()).toHaveTextContent("");
  });
});
