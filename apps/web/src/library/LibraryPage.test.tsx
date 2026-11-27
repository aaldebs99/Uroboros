import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/**
 * The person's playlists, one hiding its videos from the library or none, their channels, one hiding
 * or none (`channelHiding`), and a library that records the `hidden` each page was asked with.
 */
function serveHidden(hiding: boolean, entries: unknown[] = [entry], channelHiding = false) {
  const asked: (string | null)[] = [];
  fakeApi({
    "GET /api/library/channels": () =>
      Response.json([
        {
          key: "WyJ5b3V0dWJlIiwiaWQiLCJVQzEiXQ",
          name: "Blender",
          extractor: "youtube",
          count: 3,
          latestUpload: null,
          coverThumbnailUrl: null,
          hideFromLibrary: channelHiding,
        },
      ]),
    "GET /api/playlists": () =>
      Response.json([
        {
          id: "0190a3f2-7c1e-7000-8000-0000000000d1",
          kind: "manual",
          name: "Music",
          count: 3,
          coverThumbnailUrl: null,
          url: null,
          updatedAt: "2026-11-23T10:00:00.000Z",
          hideFromLibrary: hiding,
        },
      ]),
    "GET /api/library": (_init, url) => {
      asked.push(url.searchParams.get("hidden"));
      return Response.json({ entries, nextCursor: null });
    },
  });
  return { asked };
}

const showHiddenChip = () => screen.queryByRole("button", { name: "Show hidden" });

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

  it("leaves out what a hiding playlist holds", async () => {
    const { asked } = serveHidden(true);
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(asked).toEqual(["false"]);
  });

  it("offers Show hidden while one of the person's channels hides, though no playlist does", async () => {
    serveHidden(false, [entry], true);
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByRole("button", { name: "Show hidden" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("says when a hidden channel hides everything", async () => {
    serveHidden(false, [], true);
    await renderInRouter(<LibraryPage />);
    expect(
      await screen.findByText("Everything here is hidden by its playlists or channels."),
    ).toBeInTheDocument();
  });

  it("offers Show hidden only while one of the person's playlists hides", async () => {
    serveHidden(false);
    const { unmount } = await renderInRouter(<LibraryPage />);
    await screen.findByText("Big Buck Bunny");
    expect(showHiddenChip()).toBeNull();
    unmount();
    serveHidden(true);
    await renderInRouter(<LibraryPage />);
    expect(await screen.findByRole("button", { name: "Show hidden" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("puts Show hidden in the filters, which then ask for everything", async () => {
    serveHidden(true);
    const onFilters = vi.fn();
    const { unmount } = await renderInRouter(
      <LibraryPage filters={{ watched: false }} onFilters={onFilters} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Show hidden" }));
    expect(onFilters).toHaveBeenLastCalledWith({ watched: false, showHidden: true });
    unmount();
    const { asked } = serveHidden(true);
    await renderInRouter(<LibraryPage filters={{ showHidden: true }} />);
    expect(await screen.findByRole("button", { name: "Show hidden" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(asked).toEqual([null]);
  });

  it("finds hidden videos in a search", async () => {
    const { asked } = serveHidden(true);
    await renderInRouter(<LibraryPage filters={{ q: "bunny" }} />);
    await screen.findByText("Big Buck Bunny");
    expect(asked).toEqual([null]);
  });

  it("no longer has the account-wide Hide playlist videos chip", async () => {
    serveHidden(true);
    await renderInRouter(<LibraryPage />);
    await screen.findByText("Big Buck Bunny");
    expect(screen.queryByRole("button", { name: /Hide playlist/ })).toBeNull();
  });

  it("says when its playlists hide everything, and shows it on request", async () => {
    serveHidden(true, []);
    const onFilters = vi.fn();
    await renderInRouter(<LibraryPage onFilters={onFilters} />);
    expect(
      await screen.findByText("Everything here is hidden by its playlists or channels."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show hidden videos" }));
    expect(onFilters).toHaveBeenLastCalledWith({ showHidden: true });
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
    fakeApi({
      "GET /api/library": (_init, url) => {
        kinds.push(url.searchParams.get("kind"));
        return Response.json({ entries, nextCursor: null });
      },
    });
    return { kinds };
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

  it("leaves out hidden audio too, and offers to show it when that leaves none", async () => {
    const { asked } = serveHidden(true, []);
    await renderInRouter(<LibraryPage kind="audio" />);
    expect(
      await screen.findByText("Everything here is hidden by its playlists or channels."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show hidden audio" })).toBeInTheDocument();
    expect(asked).toEqual(["false"]);
  });
});
