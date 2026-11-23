import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { LibraryPage } from "./LibraryPage";

const entry = {
  id: "0190a3f2-7c1e-7000-8000-0000000000b1",
  mediaId: "0190a3f2-7c1e-7000-8000-0000000000b2",
  title: "Big Buck Bunny",
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  profileName: "Best up to 1080p (MP4)",
  sizeBytes: 5 * 1024 * 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: null,
  tags: [],
  channelKey: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LibraryPage", () => {
  it("lists entries with channel, profile, size and a save link", async () => {
    fakeApi({ "GET /api/library": () => Response.json([entry]) });
    renderWithQuery(<LibraryPage />);
    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(screen.getByText(/Blender/)).toBeInTheDocument();
    expect(screen.getByText(/Best up to 1080p \(MP4\)/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Save" })).toHaveAttribute(
      "href",
      `/api/library/${entry.id}/file`,
    );
  });

  it("removes an entry after asking", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = fakeApi({
      "GET /api/library": () => Response.json([entry]),
      [`DELETE /api/library/${entry.id}`]: () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<LibraryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });

  it("points an empty library at Downloads", async () => {
    fakeApi({ "GET /api/library": () => Response.json([]) });
    renderWithQuery(<LibraryPage />);
    expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Downloads" })).toHaveAttribute(
      "href",
      "/downloads",
    );
  });
});
