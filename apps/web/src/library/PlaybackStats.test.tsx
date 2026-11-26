import type { PlaybackSession } from "@uroboros/contract";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaybackStats } from "./PlaybackStats";

/** The player's Stats panel (docs/transcoding.md), over the picture. */

const url = "/api/library/e/playback/sessions/s";
const session: PlaybackSession = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  state: "running",
  mode: "encode",
  quality: "720",
  encoder: "nvenc",
  width: 1280,
  height: 720,
  bitrate: 4_000_000,
  reason: "picked",
  url,
  masterUrl: `${url}/master.m3u8`,
  error: null,
};
const item = {
  videoCodec: "vp9",
  videoCodecs: "vp09.00.40.08",
  audioCodecs: "opus",
  container: "webm",
  width: 1920,
  height: 1080,
  duration: null,
};

/** A video element as the browser would have it mid-playback. */
function playing(v: HTMLVideoElement | null) {
  if (v === null) return;
  Object.defineProperty(v, "videoWidth", { value: 1280 });
  Object.defineProperty(v, "videoHeight", { value: 720 });
  Object.defineProperty(v, "currentTime", { value: 30 });
  Object.defineProperty(v, "buffered", {
    value: { length: 1, start: () => 0, end: () => 42.5 },
  });
  Object.defineProperty(v, "getVideoPlaybackQuality", {
    value: () => ({ droppedVideoFrames: 3, totalVideoFrames: 1234 }),
  });
}

function sized(el: HTMLDivElement | null) {
  if (el === null) return;
  Object.defineProperty(el, "clientWidth", { value: 800 });
  Object.defineProperty(el, "clientHeight", { value: 450 });
}

function renderStats(s: PlaybackSession | null, onClose = vi.fn()) {
  render(
    <div className="uro-player" ref={sized}>
      <video ref={playing} />
      <PlaybackStats item={item} session={s} onClose={onClose} />
    </div>,
  );
  return onClose;
}

/** The panel's rows, label to words. */
const rows = () =>
  Object.fromEntries(
    screen.getAllByRole("term").map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
  );

/**
 * The browser's resource observer, handing the panel these fetches as it starts observing. The
 * panel can't read them from `performance.getEntriesByType`: that buffer stops at 250 entries, and
 * a long session fetches more segments than that.
 */
function fetched(entries: object[]) {
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(private readonly report: (list: { getEntries: () => object[] }) => void) {}
      observe() {
        this.report({ getEntries: () => entries });
      }
      disconnect() {
        return undefined;
      }
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PlaybackStats", () => {
  it("says how the video plays, what it is, what the session sends, and how the browser does", () => {
    fetched([
      { name: `http://h${url}/seg-3.m4s`, encodedBodySize: 1, requestStart: 0, responseEnd: 9 },
      {
        name: `http://h${url}/seg-4.m4s`,
        encodedBodySize: 7_700_000,
        requestStart: 1000,
        responseEnd: 1800,
      },
      { name: "http://h/assets/app.js", encodedBodySize: 1, requestStart: 2000, responseEnd: 2001 },
    ]);
    // Nothing in the buffered list: the observer is what counts.
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    renderStats(session);
    expect(screen.getByRole("region", { name: "Playback stats" })).toBeInTheDocument();
    expect(rows()).toEqual({
      Playback: "Transcoding to 720p · NVIDIA GPU",
      Source: "VP9 · Opus · WebM · 1920×1080",
      Output: "H.264 · 1280×720 · 4 Mb/s target",
      Viewport: "800×450 ×1 · decoding 1280×720",
      Frames: "3 dropped of 1,234",
      Buffer: "12.5 s ahead",
      Network: "last segment 7.7 MB in 0.8 s (77 Mb/s)",
    });
  });

  it("leaves out what direct play has nothing to say about", () => {
    fetched([]);
    renderStats(null);
    expect(rows().Playback).toBe("Direct play");
    expect(rows()).not.toHaveProperty("Output");
    expect(rows()).not.toHaveProperty("Network");
  });

  it("closes with its × button", async () => {
    const onClose = renderStats(null);
    await userEvent.click(screen.getByRole("button", { name: "Close stats" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
