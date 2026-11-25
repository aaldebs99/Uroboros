import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as renderBare, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { itemFixture } from "@/test/libraryItem";

import { HOLD_MS, HOVER_DELAY_MS, PreviewSurface } from "./ThumbnailPreview";
import { VideoThumbnail } from "./VideoTile";

/**
 * When a preview starts and stops; what it plays is `PreviewPlayer.test.tsx`'s. The video's
 * details never arrive here (every call 404s), so a started preview is its empty frame.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  fakeApi({});
});
afterEach(() => {
  vi.useRealTimers();
});

/** Renders inside a query client, as the app does; `rerender` keeps it. */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (el: ReactElement) => (
    <QueryClientProvider client={client}>{el}</QueryClientProvider>
  );
  const result = renderBare(wrap(ui));
  return {
    ...result,
    rerender: (el: ReactElement) => {
      result.rerender(wrap(el));
    },
  };
}

/** A thumbnail inside its link, as a tile has it; a null entry has no preview. */
function tile(name: string, entryId: string | null = `entry-${name}`) {
  return (
    <a href={`#${name}`}>
      <PreviewSurface entryId={entryId} className="relative">
        <img alt={name} src="/thumb.jpg" />
      </PreviewSurface>
    </a>
  );
}

const surfaceOf = (name: string) => screen.getByAltText(name).parentElement as HTMLElement;
const clips = () => document.querySelectorAll<HTMLElement>("[data-preview]");
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("a thumbnail's hover preview", () => {
  it("starts once a mouse rests on it, hidden from assistive tech, and stops when it leaves", () => {
    render(tile("a"));
    fireEvent.pointerEnter(surfaceOf("a"), { pointerType: "mouse" });
    wait(HOVER_DELAY_MS - 1);
    expect(clips()).toHaveLength(0);
    wait(1);
    expect(clips()[0]).toHaveAttribute("aria-hidden", "true");
    expect(surfaceOf("a")).toHaveAttribute("data-previewing");
    fireEvent.pointerLeave(surfaceOf("a"), { pointerType: "mouse" });
    expect(clips()).toHaveLength(0);
    expect(surfaceOf("a")).not.toHaveAttribute("data-previewing");
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
    expect(surfaceOf("b").querySelector("[data-preview]")).not.toBeNull();
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(clips()).toHaveLength(0);
  });

  it("is on for a grid tile's thumbnail, and off for the small rows'", () => {
    const entry = { ...itemFixture, hasVideo: true };
    const { container, rerender } = render(<VideoThumbnail entry={entry} />);
    const box = container.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(box, { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    expect(clips()).toHaveLength(0);
    rerender(<VideoThumbnail entry={entry} preview />);
    fireEvent.pointerEnter(container.firstElementChild as HTMLElement, { pointerType: "mouse" });
    wait(HOVER_DELAY_MS);
    expect(clips()).toHaveLength(1);
    // The badge stays over the picture.
    const badge = screen.getByText("9:56");
    expect(clips()[0]?.compareDocumentPosition(badge)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
