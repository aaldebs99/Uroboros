import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemFixture } from "@/test/libraryItem";

import { HOLD_MS, HOVER_DELAY_MS, PreviewSurface } from "./ThumbnailPreview";
import { VideoThumbnail } from "./VideoTile";

const CLIP = "/api/library/e1/preview?v=1";

let play: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  vi.useFakeTimers();
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A thumbnail inside its link, as a tile has it. */
function tile(name: string, previewUrl: string | null = CLIP) {
  return (
    <a href={`#${name}`}>
      <PreviewSurface previewUrl={previewUrl} className="relative">
        <img alt={name} src="/thumb.jpg" />
      </PreviewSurface>
    </a>
  );
}

const surfaceOf = (name: string) => screen.getByAltText(name).parentElement as HTMLElement;
const clips = () => document.querySelectorAll<HTMLVideoElement>("video[data-preview]");
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("a thumbnail's hover preview", () => {
  it("plays muted once a mouse rests on it, and stops when it leaves", () => {
    render(tile("a"));
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    wait(HOVER_DELAY_MS - 1);
    expect(clips()).toHaveLength(0);
    wait(1);
    const [clip] = clips();
    expect(clip).toHaveAttribute("src", CLIP);
    expect(clip?.muted).toBe(true);
    expect(clip).toHaveAttribute("aria-hidden", "true");
    expect(play).toHaveBeenCalled();
    fireEvent.pointerLeave(surfaceOf("a"), { pointerType: "mouse" });
    expect(clips()).toHaveLength(0);
  });

  it("starts nothing for a mouse passing over", () => {
    render(tile("a"));
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    wait(HOVER_DELAY_MS / 2);
    fireEvent.pointerLeave(surfaceOf("a"), { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    expect(clips()).toHaveLength(0);
  });

  it("does nothing for a video without a preview, and leaves its menus alone", () => {
    render(tile("a", null));
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    fireEvent.pointerDown(surfaceOf("a"), { pointerType: "touch" });
    wait(HOLD_MS + HOVER_DELAY_MS);
    expect(clips()).toHaveLength(0);
    expect(surfaceOf("a")).not.toHaveClass("select-none");
    expect(fireEvent.contextMenu(surfaceOf("a"))).toBe(true);
  });

  it("plays after a press and hold, swallowing the click and the menu that follow", () => {
    render(tile("a"));
    expect(surfaceOf("a")).toHaveClass("select-none");
    fireEvent.pointerDown(surfaceOf("a"), { pointerType: "touch", clientX: 10, clientY: 10 });
    wait(HOLD_MS);
    expect(clips()).toHaveLength(1);
    expect(fireEvent.contextMenu(surfaceOf("a"))).toBe(false);
    fireEvent.pointerUp(surfaceOf("a"), { pointerType: "touch" });
    // false: the click was cancelled, so the link doesn't open.
    expect(fireEvent.click(surfaceOf("a"))).toBe(false);
    expect(clips()).toHaveLength(1);
    // A tap on the playing preview opens the video.
    fireEvent.pointerDown(surfaceOf("a"), { pointerType: "touch" });
    fireEvent.pointerUp(surfaceOf("a"), { pointerType: "touch" });
    expect(fireEvent.click(surfaceOf("a"))).toBe(true);
  });

  it("leaves a quick tap to open the video, and a finger that moves to scroll", () => {
    render(tile("a"));
    fireEvent.pointerDown(surfaceOf("a"), { pointerType: "touch", clientX: 10, clientY: 10 });
    wait(HOLD_MS / 2);
    fireEvent.pointerUp(surfaceOf("a"), { pointerType: "touch" });
    expect(fireEvent.click(surfaceOf("a"))).toBe(true);
    fireEvent.pointerDown(surfaceOf("a"), { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surfaceOf("a"), { pointerType: "touch", clientX: 10, clientY: 40 });
    wait(HOLD_MS);
    expect(clips()).toHaveLength(0);
  });

  it("keeps a mouse's right-click menu", () => {
    render(tile("a"));
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    expect(fireEvent.contextMenu(surfaceOf("a"))).toBe(true);
  });

  it("plays one at a time, and stops when a touch lands elsewhere", () => {
    render(
      <>
        {tile("a")}
        {tile("b")}
      </>,
    );
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    fireEvent.pointerDown(surfaceOf("b"), { pointerType: "touch" });
    wait(HOLD_MS);
    expect(clips()).toHaveLength(1);
    expect(surfaceOf("b").querySelector("video")).not.toBeNull();
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(clips()).toHaveLength(0);
  });

  it("is on for a grid tile's thumbnail, and off for the small rows'", () => {
    const entry = { ...itemFixture, previewUrl: CLIP };
    const { container, rerender } = render(<VideoThumbnail entry={entry} />);
    const box = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(box, { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    expect(clips()).toHaveLength(0);
    rerender(<VideoThumbnail entry={entry} preview />);
    fireEvent.pointerEnter(container.firstElementChild as HTMLElement, { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    expect(clips()).toHaveLength(1);
    // The badge stays over the clip.
    const badge = screen.getByText("9:56");
    expect(clips()[0]?.compareDocumentPosition(badge)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
