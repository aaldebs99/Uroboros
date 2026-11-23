import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { useProgressReporter } from "./useProgressReporter";

vi.mock("./Player", () => ({
  Player: (props: {
    src: string;
    start: number;
    seek: { time: number } | null;
    subtitles: { lang: string }[];
  }) => (
    <div
      data-testid="player"
      data-src={props.src}
      data-start={String(props.start)}
      data-seek={props.seek === null ? "" : String(props.seek.time)}
      data-subs={props.subtitles.map((s) => s.lang).join(",")}
    />
  ),
}));

const ID = "0190a3f2-7c1e-7000-8000-0000000000c1";
const item = {
  id: ID,
  mediaId: "0190a3f2-7c1e-7000-8000-0000000000c2",
  title: "Big Buck Bunny",
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  profileName: "Best up to 1080p (MP4)",
  sizeBytes: 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: { position: 42, duration: 596, watched: false },
  tags: ["movies"],
  channelKey: "a2V5",
  description: "A large rabbit deals with three tiny bullies. ".repeat(20),
  chapters: [
    { start: 0, end: 60, title: "Opening" },
    { start: 60, end: 596, title: "The chase" },
  ],
  subtitles: [
    {
      id: "0190a3f2-7c1e-7000-8000-0000000000c3",
      lang: "en",
      name: null,
      automatic: false,
      url: `/api/library/${ID}/subtitles/x`,
    },
  ],
  streamUrl: `/api/library/${ID}/stream`,
  webpageUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  sources: [],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ItemPage", () => {
  beforeEach(() => undefined);

  it("shows the video's details and plays from where the person left off", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByRole("heading", { name: "Big Buck Bunny" })).toBeInTheDocument();
    expect(screen.getByText(/2008-05-20/)).toBeInTheDocument();
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-src", item.streamUrl);
    expect(player).toHaveAttribute("data-start", "42");
    expect(player).toHaveAttribute("data-subs", "en");
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    expect(screen.getByRole("button", { name: "less" })).toBeInTheDocument();
  });

  it("seeks when a chapter is chosen", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: /The chase/ }));
    expect(await screen.findByTestId("player")).toHaveAttribute("data-seek", "60");
  });

  it("marks it watched and edits its tags", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      [`PUT /api/library/${ID}/watched`]: () => new Response(null, { status: 204 }),
      [`PUT /api/library/${ID}/tags`]: () => Response.json({ tags: ["movies", "open"] }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Watched" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/watched"))?.body).toEqual({ watched: true });
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Add a tag" }), "Open{Enter}");
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/tags"))?.body).toEqual({
        tags: ["movies", "open"],
      });
    });
  });
});

describe("useProgressReporter", () => {
  it("reports at most every 10 seconds, and at once on pause", () => {
    vi.useFakeTimers();
    const report = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useProgressReporter(report));
    act(() => {
      result.current.onTime(1, 100);
      result.current.onTime(2, 100);
    });
    expect(report).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
      result.current.onTime(6, 100);
    });
    expect(report).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(6000);
      result.current.onTime(12, 100);
    });
    expect(report).toHaveBeenCalledTimes(2);
    act(() => {
      result.current.onPause(13, 100);
    });
    expect(report).toHaveBeenLastCalledWith(13, 100);
    expect(report).toHaveBeenCalledTimes(3);
  });
});
