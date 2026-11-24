import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { useProgressReporter } from "./useProgressReporter";

// jsdom plays nothing; these pages are about a browser that plays the original.
vi.mock("./playable", () => ({ canPlayOriginal: () => true, hasNativeHls: () => false }));

vi.mock("./Player", () => ({
  Player: (props: {
    src: string;
    hls?: { native: boolean };
    start: number;
    seek: { time: number } | null;
    subtitles: { lang: string }[];
  }) => (
    <div
      data-testid="player"
      data-src={props.src}
      data-hls={props.hls === undefined ? "" : props.hls.native ? "native" : "mse"}
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
  kept: false,
  subscription: null,
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
  videoCodec: "h264",
  audioCodec: "aac",
  playbackUrl: `/api/library/${ID}/playback`,
  videoCodecs: null,
  audioCodecs: null,
  width: null,
  height: null,
  qualities: [],
  webpageUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  sources: [],
  playlists: [],
  sharedBy: null,
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

describe("ItemPage compatible version", () => {
  it("switches to the compatible version by hand, and back", async () => {
    const done = {
      state: "done",
      mode: "encode",
      readySegments: 3,
      progress: 1,
      masterUrl: `/api/library/${ID}/playback/master.m3u8`,
      error: null,
    };
    fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      [`POST /api/library/${ID}/playback`]: () => Response.json(done),
      [`GET /api/library/${ID}/playback`]: () => Response.json(done),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByTestId("player")).toHaveAttribute("data-hls", "");
    await userEvent.click(screen.getByRole("button", { name: /Use the compatible version/ }));
    await waitFor(() => {
      expect(screen.getByTestId("player")).toHaveAttribute("data-hls", "mse");
    });
    expect(screen.getByTestId("player")).toHaveAttribute("data-src", done.masterUrl);
    await userEvent.click(screen.getByRole("button", { name: "Play the original" }));
    await waitFor(() => {
      expect(screen.getByTestId("player")).toHaveAttribute("data-hls", "");
    });
  });
});

describe("ItemPage Keep", () => {
  it("toggles Keep on an entry from a subscription", async () => {
    const fromSub = {
      ...item,
      subscription: { id: "0190a3f2-7c1e-7000-8000-0000000000aa", title: "Blender" },
    };
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(fromSub),
      [`PUT /api/library/${ID}/kept`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Keep" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/kept"))?.body).toEqual({ kept: true });
    });
  });

  it("shows no Keep for an entry no subscription brought", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await screen.findByRole("switch", { name: "Watched" });
    expect(screen.queryByRole("switch", { name: "Keep" })).not.toBeInTheDocument();
  });
});

describe("ItemPage suggestions", () => {
  it("suggests the rest of the library beside the player, without the video playing", async () => {
    const other = { ...item, id: "0190a3f2-7c1e-7000-8000-0000000000d1", title: "Sintel" };
    fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      "GET /api/library": () => Response.json({ entries: [item, other], nextCursor: null }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    const aside = await screen.findByRole("complementary", { name: "Suggestions" });
    const link = await within(aside).findByRole("link", { name: /Sintel/ });
    expect(link).toHaveAttribute("href", `/library/${other.id}`);
    expect(within(aside).queryByRole("link", { name: /Big Buck Bunny/ })).not.toBeInTheDocument();
  });
});

describe("ItemPage actions", () => {
  it("links each tag to the library filtered by it, and removes the entry after asking", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      [`DELETE /api/library/${ID}`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByRole("link", { name: "movies" })).toHaveAttribute(
      "href",
      "/?tag=movies",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
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
