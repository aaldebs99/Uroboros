import type { ClipRange } from "@uroboros/contract";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { Player } from "./Player";

/**
 * A clip picked (docs/sharing.md#clips): its two handles on the timeline, by pointer and by key,
 * never seeking or playing the video.
 */

const noop = () => undefined;
const base = {
  src: "/v",
  title: "t",
  start: 0,
  autoPlay: false,
  seek: null,
  chapters: [],
  subtitles: [],
  onTime: noop,
  onPause: noop,
  onEnded: noop,
};

const restores: (() => void)[] = [];
let play: MockInstance<HTMLMediaElement["play"]>;
function stub<K extends keyof HTMLMediaElement>(key: K, value: HTMLMediaElement[K]) {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, key);
  Object.defineProperty(HTMLMediaElement.prototype, key, { configurable: true, get: () => value });
  restores.push(() => {
    if (desc) Object.defineProperty(HTMLMediaElement.prototype, key, desc);
  });
}

beforeEach(() => {
  stub("readyState", 4);
  stub("duration", 600);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  // The timeline is 1000 wide here: a pixel is 0.6 s of the 600 s video.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 1000,
    top: 0,
    height: 16,
    right: 1000,
    bottom: 16,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  vi.restoreAllMocks();
});

/** The player with a clip the test can watch, at `at` seconds of the 600 s video. */
async function clipping(at = 100, initial: ClipRange | null = null) {
  const changes: (ClipRange | null)[] = [];
  function Harness() {
    const [clip, setClip] = useState<ClipRange | null>(initial);
    return (
      <Player
        {...base}
        clip={{
          value: clip,
          onChange: (r) => {
            changes.push(r);
            setClip(r);
          },
        }}
      />
    );
  }
  const { container } = render(<Harness />);
  const video = container.querySelector("video") as HTMLVideoElement;
  video.currentTime = at;
  fireEvent(video, new Event("durationchange"));
  fireEvent(video, new Event("timeupdate"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { container, video, changes };
}

describe("the clip's handles", () => {
  it("are two sliders, named, with their times", async () => {
    await clipping(100, { start: 62, end: 90 });
    const start = screen.getByRole("slider", { name: "Clip start" });
    const end = screen.getByRole("slider", { name: "Clip end" });
    expect(start).toHaveAttribute("aria-valuenow", "62");
    expect(start).toHaveAttribute("aria-valuetext", "1:02");
    expect(end).toHaveAttribute("aria-valuenow", "90");
    expect(end).toHaveAttribute("aria-valuemax", "600");
  });

  it("move a second with the arrows, without the player seeking 5 s", async () => {
    const { video, changes } = await clipping(100, { start: 62, end: 90 });
    const end = screen.getByRole("slider", { name: "Clip end" });
    fireEvent.keyDown(end, { key: "ArrowRight" });
    expect(changes.at(-1)).toEqual({ start: 62, end: 91 });
    expect(video.currentTime).toBe(100);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Clip start" }), {
      key: "ArrowLeft",
      shiftKey: true,
    });
    expect(changes.at(-1)).toEqual({ start: 52, end: 91 });
    expect(video.currentTime).toBe(100);
  });

  it("never play the video with Space, and leave clip mode with Escape", async () => {
    const { changes } = await clipping(100, { start: 62, end: 90 });
    const start = screen.getByRole("slider", { name: "Clip start" });
    fireEvent.keyDown(start, { key: " " });
    expect(play).not.toHaveBeenCalled();
    fireEvent.keyDown(start, { key: "Escape" });
    expect(changes.at(-1)).toBeNull();
    expect(screen.queryByRole("slider", { name: "Clip start" })).toBeNull();
  });

  it("follow a drag, and the timeline never seeks while one is dragged", async () => {
    const { video, changes } = await clipping(100, { start: 62, end: 90 });
    const end = screen.getByRole("slider", { name: "Clip end" });
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 150, button: 0 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 200 });
    expect(changes.at(-1)).toEqual({ start: 62, end: 120 });
    expect(video.currentTime).toBe(100);
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 200 });
    // Let go, the picture shows the frame the handle is at.
    await waitFor(() => {
      expect(video.currentTime).toBe(120);
    });
  });

  it("aren't there without a clip picked", () => {
    render(<Player {...base} clip={{ value: null, onChange: noop }} />);
    expect(screen.queryByRole("slider", { name: "Clip start" })).toBeNull();
  });

  it("draw a range given to show, alone, without handles", () => {
    const { container } = render(<Player {...base} range={{ start: 62, end: 90 }} />);
    expect(container.querySelector(".uro-clip-band")).not.toBeNull();
    expect(screen.queryByRole("slider", { name: "Clip start" })).toBeNull();
  });
});
