import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LibraryItem, PlaybackSession } from "@uroboros/contract";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSubtitleLang, storeSubtitleLang } from "@/lib/playerPrefs";
import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID, itemFixture } from "@/test/libraryItem";
import { withTextTracks } from "@/test/textTracks";

import { setPreviewSound } from "./previewSound";
import { HOVER_DELAY_MS, PreviewSurface } from "./ThumbnailPreview";
import { VideoThumbnail } from "./VideoTile";

const STORED = `/api/library/${ITEM_ID}/preview?v=1`;
/** An MP4 this browser plays, for the cases where the original may play. */
const PLAYABLE = { videoCodecs: "avc1.64001f", audioCodecs: "mp4a.40.2" };
const SESSION_URL = `/api/library/${ITEM_ID}/playback/0190a3f2-7c1e-7000-8000-0000000000d1`;
const subtitles = (["en", "fr"] as const).map((lang, i) => ({
  id: `0190a3f2-7c1e-7000-8000-0000000000e${String(i)}`,
  lang,
  name: null,
  automatic: false,
  url: `/api/library/${ITEM_ID}/subtitles/${lang}`,
}));
const session: PlaybackSession = {
  id: "0190a3f2-7c1e-7000-8000-0000000000d1",
  state: "queued",
  mode: "encode",
  quality: "480",
  encoder: null,
  width: null,
  height: null,
  reason: "picked",
  url: SESSION_URL,
  masterUrl: `${SESSION_URL}/master.m3u8`,
  error: null,
};

let calls: ReturnType<typeof fakeApi>;
let restoreTracks: () => void;

function serve(item: Partial<LibraryItem>) {
  calls = fakeApi({
    [`GET /api/library/${ITEM_ID}`]: () => Response.json({ ...itemFixture, subtitles, ...item }),
    [`POST /api/library/${ITEM_ID}/playback`]: () => Response.json(session),
    [`GET ${SESSION_URL}`]: () => Response.json(session),
    [`DELETE ${SESSION_URL}`]: () => new Response(null, { status: 204 }),
  });
}

beforeEach(() => {
  // Fake time that also runs on its own, so a fetched item renders while the hover delay is skipped.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  restoreTracks = withTextTracks();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  // A drag seeks once a frame; here the frame comes at once.
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  restoreTracks();
  setPreviewSound(false);
  localStorage.clear();
  vi.useRealTimers();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

/** A tile's thumbnail inside its link; returns a way to start and stop its preview. */
function tile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <a href="#watch">
        <PreviewSurface entryId={ITEM_ID} className="relative">
          <img alt="thumb" src="/thumb.jpg" />
        </PreviewSurface>
      </a>
    </QueryClientProvider>,
  );
  const surface = screen.getByAltText("thumb").parentElement as HTMLElement;
  const start = async () => {
    fireEvent.pointerEnter(surface, { pointerType: "mouse" });
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DELAY_MS));
    // The item arrives, then the preview mounts its source: a file, or a session it asks for.
    await waitFor(() => {
      expect(video() !== null || calls.some((c) => c.method === "POST")).toBe(true);
    });
    const v = video();
    if (v !== null) fireEvent(v, new Event("playing"));
  };
  const stop = async () => {
    fireEvent.pointerLeave(surface, { pointerType: "mouse" });
    await flush();
  };
  return { start, stop, surface };
}

/** The preview playing a 100 s video, its scrub track 200px wide from x = 0. */
async function playing100() {
  serve({ previewUrl: STORED });
  const t = tile();
  await t.start();
  const v = video() as HTMLVideoElement;
  Object.defineProperty(v, "duration", { configurable: true, get: () => 100 });
  fireEvent(v, new Event("durationchange"));
  const track = document.querySelector("[data-scrub-track]") as HTMLElement;
  track.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
  return { ...t, v, bar: document.querySelector("[data-scrub-bar]") as HTMLElement };
}

const video = () => document.querySelector<HTMLVideoElement>("video[data-preview-video]");
const track = (lang: string) =>
  (document.querySelector(`track[srclang="${lang}"]`) as HTMLTrackElement).track;
const button = (name: string) => screen.getByRole("button", { name, hidden: true });
/** Clicks like a person: false when the click was kept from following the tile's link. */
const click = (el: Element) => fireEvent.click(el);

describe("a tile's preview player", () => {
  it("plays the stored preview muted, with captions on in the remembered language", async () => {
    storeSubtitleLang("fr");
    serve({ previewUrl: STORED });
    await tile().start();
    expect(video()).toHaveAttribute("src", STORED);
    expect(video()?.muted).toBe(true);
    expect(track("fr").mode).toBe("showing");
    expect(track("en").mode).not.toBe("showing");
  });

  it("keeps sound on for later previews once unmuted, until it is muted again", async () => {
    serve({ previewUrl: STORED });
    const t = tile();
    await t.start();
    const sound = button("Preview sound");
    expect(sound).toHaveAttribute("aria-pressed", "false");
    expect(click(sound)).toBe(false);
    expect(video()?.muted).toBe(false);
    await t.stop();
    await t.start();
    expect(video()?.muted).toBe(false);
    click(button("Preview sound"));
    expect(video()?.muted).toBe(true);
    await t.stop();
    await t.start();
    expect(video()?.muted).toBe(true);
  });

  it("turns captions off and on without changing the player's remembered choice", async () => {
    serve({ previewUrl: STORED });
    await tile().start();
    expect(track("en").mode).toBe("showing");
    expect(click(button("Preview captions"))).toBe(false);
    expect(track("en").mode).not.toBe("showing");
    click(button("Preview captions"));
    expect(track("en").mode).toBe("showing");
    expect(readSubtitleLang()).toBeNull();
  });

  it("offers no captions button for a video without subtitles", async () => {
    serve({ previewUrl: STORED, subtitles: [] });
    await tile().start();
    expect(screen.queryByRole("button", { name: "Preview captions", hidden: true })).toBeNull();
  });

  it("seeks where the scrub bar is pressed and follows a drag, without opening the video", async () => {
    const { v, bar } = await playing100();
    const at = (clientX: number) => ({ clientX, pointerId: 1, pointerType: "mouse", buttons: 1 });
    // Kept from the browser: no link drag, no text selection.
    expect(fireEvent.pointerDown(bar, at(50))).toBe(false);
    expect(v.currentTime).toBe(25);
    fireEvent.pointerMove(bar, at(150));
    expect(v.currentTime).toBe(75);
    fireEvent.pointerUp(bar, at(150));
    fireEvent.pointerMove(bar, { ...at(20), buttons: 0 });
    expect(v.currentTime).toBe(75);
    expect(fireEvent(bar, new Event("dragstart", { bubbles: true, cancelable: true }))).toBe(false);
    expect(click(bar)).toBe(false);
    expect(document.querySelector("[data-preview]")).not.toBeNull();
  });

  it("steps a second per wheel notch, back or forward, instead of scrolling the page", async () => {
    const { v, surface } = await playing100();
    v.currentTime = 10;
    expect(fireEvent.wheel(surface, { deltaY: 100 })).toBe(false);
    expect(v.currentTime).toBe(11);
    fireEvent.wheel(surface, { deltaY: -100 });
    expect(v.currentTime).toBe(10);
    // Firefox counts lines.
    fireEvent.wheel(surface, { deltaY: 3, deltaMode: 1 });
    expect(v.currentTime).toBe(11);
    // A trackpad's small nudges add up to a step.
    fireEvent.wheel(surface, { deltaY: 40 });
    expect(v.currentTime).toBe(11);
    fireEvent.wheel(surface, { deltaY: 60 });
    expect(v.currentTime).toBe(12);
  });

  it("leaves the wheel to scroll the page until the preview plays", () => {
    serve({ previewUrl: STORED });
    const { surface } = tile();
    expect(fireEvent.wheel(surface, { deltaY: 100 })).toBe(true);
  });

  it("never reports watch progress or touches the player's volume", async () => {
    serve({ previewUrl: STORED });
    const t = tile();
    await t.start();
    const v = video() as HTMLVideoElement;
    click(button("Preview sound"));
    v.currentTime = 30;
    fireEvent(v, new Event("timeupdate"));
    fireEvent(v, new Event("pause"));
    fireEvent(v, new Event("ended"));
    await flush();
    expect(calls.some((c) => c.path.endsWith("/progress"))).toBe(false);
    expect(localStorage.getItem("uroboros-player-volume")).toBeNull();
  });

  it("gives the thumbnail back when the video ends", async () => {
    serve({ previewUrl: STORED });
    await tile().start();
    fireEvent(video() as HTMLVideoElement, new Event("ended"));
    expect(document.querySelector("[data-preview]")).toBeNull();
  });

  it("plays the original when there is no stored preview and the browser can", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    serve({ previewUrl: null, ...PLAYABLE });
    await tile().start();
    expect(video()).toHaveAttribute("src", itemFixture.streamUrl);
  });

  it("moves on to the next source when one fails", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    serve({ previewUrl: STORED, ...PLAYABLE });
    await tile().start();
    fireEvent(video() as HTMLVideoElement, new Event("error"));
    expect(video()).toHaveAttribute("src", itemFixture.streamUrl);
  });

  it("transcodes a live 480p copy when nothing else plays, and stops it with the preview", async () => {
    serve({ previewUrl: null });
    const t = tile();
    await t.start();
    const post = calls.find((c) => c.method === "POST");
    expect(post).toMatchObject({
      path: `/api/library/${ITEM_ID}/playback`,
      body: { quality: "480", start: 0, copyVideo: false, copyAudio: false },
    });
    await t.stop();
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path === SESSION_URL)).toBe(true);
    });
  });
});

describe("which tiles preview", () => {
  it("offers no preview for sound alone", async () => {
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <VideoThumbnail entry={{ ...itemFixture, hasVideo: false }} preview />
      </QueryClientProvider>,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box).not.toHaveClass("select-none");
    fireEvent.pointerEnter(box, { pointerType: "mouse" });
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DELAY_MS));
    expect(document.querySelector("[data-preview]")).toBeNull();
  });
});
