import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});

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
    // Body text on the soft accent: the accent's own text colour on it is under AA at this size.
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
