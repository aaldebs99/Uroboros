import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SPONSORBLOCK, DEFAULT_SPONSORBLOCK_COLORS } from "@uroboros/contract";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { LibraryPage } from "./LibraryPage";

const entry = {
  id: "0190a3f2-7c1e-7000-8000-0000000000b1",
  mediaId: "0190a3f2-7c1e-7000-8000-0000000000b2",
  title: "Big Buck Bunny",
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  previewUrl: null,
  hasVideo: false,
  profileName: "Best up to 1080p (MP4)",
  origin: "download",
  sizeBytes: 5 * 1024 * 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: null,
  tags: [],
  kept: false,
  subscription: null,
  channelKey: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  // Sonner replays toasts still showing to the next test's Toaster.
  toast.dismiss();
});

/** The account's preferences and a library that records the `inPlaylist` each page was asked with. */
function serveHiding(hide: boolean, entries: unknown[] = [entry]) {
  const asked: (string | null)[] = [];
  const calls = fakeApi({
    "GET /api/me/preferences": () =>
      Response.json({
        hidePlaylistVideos: hide,
        sponsorBlock: DEFAULT_SPONSORBLOCK,
        sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
      }),
    // The only change these tests make is turning it on.
    "PATCH /api/me/preferences": () =>
      Response.json({
        hidePlaylistVideos: true,
        sponsorBlock: DEFAULT_SPONSORBLOCK,
        sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
      }),
    "GET /api/library": (_init, url) => {
      asked.push(url.searchParams.get("inPlaylist"));
      return Response.json({ entries, nextCursor: null });
    },
  });
  return { asked, calls };
}

const hideChip = () => screen.getByRole("button", { name: "Hide playlist videos" });

describe("LibraryPage", () => {
  it("leaves the profile out of an upload's meta line", async () => {
    const upload = { ...entry, profileName: null, origin: "upload" };
    fakeApi({ "GET /api/library": () => Response.json({ entries: [upload], nextCursor: null }) });
    await renderInRouter(<LibraryPage />);
    const meta = await screen.findByText(/MB · added/);
    expect(meta.textContent).toMatch(/^\d[\d.]* MB · added/);
  });

  it("lists entries with channel, profile, size and a save link", async () => {
    fakeApi({ "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }) });
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(screen.getByText(/Blender/)).toBeInTheDocument();
    expect(screen.getByText(/Best up to 1080p \(MP4\)/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Big Buck Bunny" }));
    expect(await screen.findByRole("link", { name: "Save" })).toHaveAttribute(
      "href",
      `/api/library/${entry.id}/file`,
    );
  });

  it("opens the video from its thumbnail as well as its title", async () => {
    fakeApi({ "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }) });
    const { container } = await renderInRouter(<LibraryPage />);
    expect(await screen.findByRole("link", { name: "Big Buck Bunny" })).toHaveAttribute(
      "href",
      `/library/${entry.id}`,
    );
    // The thumbnail link is hidden from assistive tech (the title is that link), so find it by
    // its href rather than its role.
    const thumb = container.querySelector(`a[href="/library/${entry.id}"][aria-hidden="true"]`);
    expect(thumb).not.toBeNull();
    expect(thumb).toHaveAttribute("tabindex", "-1");
  });

  it("removes an entry after asking", async () => {
    const calls = fakeApi({
      "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }),
      [`DELETE /api/library/${entry.id}`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<LibraryPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Actions for Big Buck Bunny" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });

  it("warns that removing an upload deletes it", async () => {
    const upload = { ...entry, profileName: null, origin: "upload" };
    fakeApi({ "GET /api/library": () => Response.json({ entries: [upload], nextCursor: null }) });
    await renderInRouter(<LibraryPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Actions for Big Buck Bunny" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/an upload can't be downloaded again/i)).toBeInTheDocument();
  });

  it("puts the sort beside the filter chips, and sorting keeps the filters", async () => {
    fakeApi({ "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }) });
    const onFilters = vi.fn();
    await renderInRouter(<LibraryPage filters={{ watched: false }} onFilters={onFilters} />);
    const sort = await screen.findByRole("combobox", { name: "Sort" });
    const chips = screen.getByRole("toolbar", { name: "Filter" });
    expect(chips.parentElement).toContainElement(sort);

    await userEvent.selectOptions(sort, "title");
    expect(onFilters).toHaveBeenLastCalledWith({ watched: false, sort: "title" });
  });

  it("shows where a search matched, and a timed match plays from its moment", async () => {
    const said = {
      ...entry,
      id: "0190a3f2-7c1e-7000-8000-0000000000c1",
      title: "Lecture",
      match: {
        in: "captions",
        snippet: [
          { text: "and then the ", mark: false },
          { text: "dragon", mark: true },
        ],
        start: 754.6,
      },
    };
    const written = {
      ...entry,
      id: "0190a3f2-7c1e-7000-8000-0000000000c2",
      title: "Talk",
      match: {
        in: "description",
        snippet: [
          { text: "…met a ", mark: false },
          { text: "dragon", mark: true },
        ],
        start: null,
      },
    };
    const titled = { ...entry, match: null };
    fakeApi({
      "GET /api/library": () =>
        Response.json({ entries: [said, written, titled], nextCursor: null }),
    });
    await renderInRouter(<LibraryPage filters={{ q: "dragon" }} />);
    const timed = await screen.findByRole("link", { name: /Captions · 12:35/ });
    expect(timed).toHaveAttribute("href", `/library/${said.id}?t=754`);
    const mark = timed.querySelector("mark");
    expect(mark?.textContent).toBe("dragon");
    // Body text on the soft accent: the accent's own text color on it is under AA at this size.
    expect(mark?.className).toMatch(/\btext-foreground\b/);
    const described = screen.getByText(/Description/);
    expect(described.closest("a")).toBeNull();
    expect(described.closest("p")?.textContent).toBe("Description · …met a dragon");
    // A title match shows nothing more: the tile has the title.
    expect(screen.getAllByText(/Captions|Description|Chapter/)).toHaveLength(2);
  });

  it("asks for 3 characters before it searches", async () => {
    const calls = fakeApi({
      "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }),
    });
    await renderInRouter(<LibraryPage filters={{ q: " ab " }} />);
    expect(await screen.findByText("Type at least 3 characters.")).toBeInTheDocument();
    expect(screen.getByText(/finds words in titles, channels, chapters/)).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/api/library")).toEqual([]);
  });

  it("leaves out playlist videos from the first page while the account says so", async () => {
    const { asked } = serveHiding(true);
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(hideChip()).toHaveAttribute("aria-pressed", "true");
    expect(asked).toEqual(["false"]);
  });

  it("saves the choice to the account when the chip is pressed", async () => {
    const { asked, calls } = serveHiding(false);
    await renderInRouter(<LibraryPage />);
    await screen.findByText("Big Buck Bunny");
    expect(asked).toEqual([null]);
    await userEvent.click(hideChip());
    expect(hideChip()).toHaveAttribute("aria-pressed", "true");
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ hidePlaylistVideos: true });
    await waitFor(() => {
      expect(asked.at(-1)).toBe("false");
    });
  });

  it("puts the chip back and says why when the account refuses the change", async () => {
    const refuse = fakeApi({
      "GET /api/me/preferences": () =>
        Response.json({
          hidePlaylistVideos: false,
          sponsorBlock: DEFAULT_SPONSORBLOCK,
          sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
        }),
      "PATCH /api/me/preferences": () =>
        Response.json({ code: "unavailable", message: "starting" }, { status: 503 }),
      "GET /api/library": () => Response.json({ entries: [entry], nextCursor: null }),
    });
    await renderInRouter(
      <>
        <Toaster />
        <LibraryPage />
      </>,
    );
    await screen.findByText("Big Buck Bunny");
    await userEvent.click(hideChip());
    expect(await screen.findByText(/server is not ready/)).toBeInTheDocument();
    expect(hideChip()).toHaveAttribute("aria-pressed", "false");
    expect(refuse.some((c) => c.method === "PATCH")).toBe(true);
  });

  it("points at Playlists when hiding their videos leaves none", async () => {
    serveHiding(true, []);
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByText("Nothing outside your playlists.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Playlists" })).toHaveAttribute(
      "href",
      "/library/playlists",
    );
  });

  it("points an empty library at Downloads", async () => {
    fakeApi({ "GET /api/library": () => Response.json({ entries: [], nextCursor: null }) });
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Downloads" })).toHaveAttribute(
      "href",
      "/downloads",
    );
  });
});

describe("LibraryPage's Videos and Audio views", () => {
  /** A library that records the `kind` each page was asked with. */
  function serveKinds(entries: unknown[] = [entry]) {
    const kinds: (string | null)[] = [];
    const calls = fakeApi({
      "GET /api/me/preferences": () =>
        Response.json({
          hidePlaylistVideos: false,
          sponsorBlock: DEFAULT_SPONSORBLOCK,
          sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
        }),
      "PATCH /api/me/preferences": () =>
        Response.json({
          hidePlaylistVideos: true,
          sponsorBlock: DEFAULT_SPONSORBLOCK,
          sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
        }),
      "GET /api/library": (_init, url) => {
        kinds.push(url.searchParams.get("kind"));
        return Response.json({ entries, nextCursor: null });
      },
    });
    return { kinds, calls };
  }

  it("asks for the videos alone on Videos", async () => {
    const { kinds } = serveKinds();
    await renderInRouter(<LibraryPage />);
    await screen.findByText("Big Buck Bunny");
    expect(kinds).toEqual(["video"]);
  });

  it("asks for the audio alone on Audio", async () => {
    const { kinds } = serveKinds();
    await renderInRouter(<LibraryPage kind="audio" />);
    await screen.findByText("Big Buck Bunny");
    expect(kinds).toEqual(["audio"]);
  });

  it("searches both on either view", async () => {
    const { kinds } = serveKinds();
    await renderInRouter(<LibraryPage kind="audio" filters={{ q: "bunny", tag: "music" }} />);
    await screen.findByText("Big Buck Bunny");
    expect(kinds).toEqual([null]);
  });

  it("calls the chip Hide playlist audio on Audio, and saves the same setting", async () => {
    const { calls } = serveKinds();
    await renderInRouter(<LibraryPage kind="audio" />);
    await screen.findByText("Big Buck Bunny");
    expect(screen.queryByRole("button", { name: "Hide playlist videos" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hide playlist audio" }));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ hidePlaylistVideos: true });
  });

  it("says when there is no audio yet", async () => {
    serveKinds([]);
    await renderInRouter(<LibraryPage kind="audio" />);
    expect(await screen.findByText("No audio yet.")).toBeInTheDocument();
    expect(screen.getByText(/audio-only profile/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Downloads" })).toHaveAttribute(
      "href",
      "/downloads",
    );
  });

  it("says how to see playlist audio when hiding it leaves none", async () => {
    serveHiding(true, []);
    await renderInRouter(<LibraryPage kind="audio" />);
    expect(await screen.findByText("Nothing outside your playlists.")).toBeInTheDocument();
    expect(screen.getByText(/Turn off Hide playlist audio/)).toBeInTheDocument();
  });
});
