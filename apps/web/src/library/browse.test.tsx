import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "@/test/render";

import { ChannelPage } from "./ChannelPage";
import { ChannelsPage } from "./ChannelsPage";
import { LibraryPage } from "./LibraryPage";
import { PlaylistPage } from "./PlaylistPage";
import { PlaylistsPage } from "./PlaylistsPage";

const entry = (n: number, over: Record<string, unknown> = {}) => ({
  id: `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`,
  mediaId: `0190a3f2-7c1e-7000-9000-${String(n).padStart(12, "0")}`,
  title: `Video ${String(n)}`,
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  previewUrl: null,
  hasVideo: false,
  profileName: "Best up to 1080p (MP4)",
  origin: "download",
  sizeBytes: 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: null,
  tags: [],
  kept: false,
  subscription: null,
  channelKey: "a2V5",
  ...over,
});

const KEY = "WyJ5b3V0dWJlIiwiaWQiLCJVQzEiXQ";
const SOURCE = "0190a3f2-7c1e-7000-8000-00000000abcd";

/** Stubs fetch by pathname, recording every full URL asked for. */
function api(routes: Record<string, (url: URL) => unknown>) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://app.test");
      urls.push(url);
      const handler = routes[url.pathname];
      return Promise.resolve(
        handler
          ? Response.json(handler(url))
          : Response.json({ code: "not_found", message: "x" }, { status: 404 }),
      );
    }),
  );
  return urls;
}

const libraryCalls = (urls: URL[]) => urls.filter((u) => u.pathname === "/api/library");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("library browsing", () => {
  it("draws tiles with a duration badge, the channel initial and the watched bar", async () => {
    api({
      "/api/library": () => ({
        entries: [entry(1, { progress: { position: 30, duration: 60, watched: false } })],
        nextCursor: null,
      }),
    });
    await renderInRouter(<LibraryPage />);
    const tile = (await screen.findByText("Video 1")).closest("li") as HTMLElement;
    expect(within(tile).getByText("9:56")).toBeInTheDocument();
    expect(within(tile).getByText("B")).toBeInTheDocument();
    expect(tile.querySelector("[data-watched-bar] > span")).toHaveStyle({ width: "50%" });
  });

  it("asks the server with the page's filters, and chips change them", async () => {
    const urls = api({ "/api/library": () => ({ entries: [entry(1)], nextCursor: null }) });
    const onFilters = vi.fn();
    await renderInRouter(
      <LibraryPage filters={{ q: "bunny", tag: "music" }} onFilters={onFilters} />,
    );
    await screen.findByText("Video 1");
    expect(libraryCalls(urls)[0]?.searchParams.get("q")).toBe("bunny");
    expect(libraryCalls(urls)[0]?.searchParams.get("tag")).toBe("music");
    await userEvent.click(screen.getByRole("button", { name: "Unwatched" }));
    expect(onFilters).toHaveBeenLastCalledWith({ q: "bunny", tag: "music", watched: false });
    await userEvent.click(screen.getByRole("button", { name: "Remove filter: music" }));
    expect(onFilters).toHaveBeenLastCalledWith({ q: "bunny" });
  });

  it("sorts from the menu", async () => {
    api({ "/api/library": () => ({ entries: [entry(1)], nextCursor: null }) });
    const onFilters = vi.fn();
    await renderInRouter(<LibraryPage filters={{ q: "x" }} onFilters={onFilters} />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Sort" }), "title");
    expect(onFilters).toHaveBeenLastCalledWith({ q: "x", sort: "title" });
  });

  it("marks a tile watched from its menu", async () => {
    const urls = api({ "/api/library": () => ({ entries: [entry(1)], nextCursor: null }) });
    await renderInRouter(<LibraryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Video 1" }));
    await userEvent.click(await screen.findByText("Mark watched"));
    await waitFor(() => {
      expect(urls.some((u) => u.pathname === `/api/library/${entry(1).id}/watched`)).toBe(true);
    });
  });

  it("loads the next page from the cursor", async () => {
    const urls = api({
      "/api/library": (u) =>
        u.searchParams.get("cursor") === "next"
          ? { entries: [entry(2)], nextCursor: null }
          : { entries: [entry(1)], nextCursor: "next" },
    });
    await renderInRouter(<LibraryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Video 2")).toBeInTheDocument();
    expect(libraryCalls(urls).at(-1)?.searchParams.get("cursor")).toBe("next");
  });

  it("lists channels with counts, linking to each channel's page", async () => {
    api({
      "/api/library/channels": () => [
        {
          key: KEY,
          name: "Blender",
          extractor: "youtube",
          count: 12,
          latestUpload: "2026-11-01",
          coverThumbnailUrl: null,
        },
      ],
    });
    await renderInRouter(<ChannelsPage />);
    const link = await screen.findByRole("link", { name: /Blender/ });
    expect(link).toHaveAttribute("href", `/library/channels/${KEY}`);
    expect(screen.getByText(/12 downloaded/)).toBeInTheDocument();
  });

  it("shows a channel's header and only its videos", async () => {
    const urls = api({
      "/api/library/channels": () => [
        {
          key: KEY,
          name: "Blender",
          extractor: "youtube",
          count: 1,
          latestUpload: null,
          coverThumbnailUrl: null,
        },
      ],
      "/api/library": () => ({ entries: [entry(1)], nextCursor: null }),
    });
    await renderInRouter(<ChannelPage channelKey={KEY} />);
    expect(await screen.findByRole("heading", { name: "Blender" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Channels" })).toHaveAttribute(
      "href",
      "/library/channels",
    );
    await screen.findByText("Video 1");
    expect(libraryCalls(urls)[0]?.searchParams.get("channel")).toBe(KEY);
  });

  it("lists playlists as tiles with counts, and a playlist page asks for its videos in order", async () => {
    const playlist = {
      id: SOURCE,
      kind: "youtube",
      name: "Open movies",
      url: "https://x.example/p",
      count: 14,
      coverThumbnailUrl: null,
      updatedAt: "2026-11-22T10:00:00.000Z",
      hideFromLibrary: false,
    };
    const urls = api({
      "/api/playlists": () => [playlist],
      [`/api/playlists/${SOURCE}`]: () => ({ ...playlist, description: null }),
      "/api/library": () => ({ entries: [entry(1)], nextCursor: null }),
    });
    await renderInRouter(<PlaylistsPage />);
    expect(await screen.findByText("14 videos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open movies/ })).toHaveAttribute(
      "href",
      `/library/playlists/${SOURCE}`,
    );
    await renderInRouter(<PlaylistPage playlistId={SOURCE} />);
    await waitFor(() => {
      expect(libraryCalls(urls).some((u) => u.searchParams.get("source") === SOURCE)).toBe(true);
    });
  });
});
