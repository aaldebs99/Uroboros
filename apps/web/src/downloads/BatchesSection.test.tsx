import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { BatchesSection } from "./BatchesSection";

const ID = "0190a3f2-7c1e-7000-8000-0000000000b1";

const batch = (over: Record<string, unknown> = {}) => ({
  id: ID,
  url: "https://www.youtube.com/playlist?list=PL1",
  title: "Blender - Videos",
  kind: "playlist",
  waiting: 431,
  done: 17,
  failed: 2,
  ...over,
});

const show = () =>
  renderWithQuery(
    <>
      <BatchesSection />
      <Toaster />
    </>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playlists still downloading", () => {
  it("lists each with how many of its videos wait, are done and failed", async () => {
    fakeApi({
      "GET /api/downloads/batches": () =>
        Response.json([
          batch(),
          batch({
            id: "0190a3f2-7c1e-7000-8000-0000000000b2",
            title: "Blender",
            kind: "channel",
            waiting: 1,
            done: 0,
            failed: 0,
          }),
        ]),
    });
    show();
    const section = await screen.findByRole("region", { name: "Downloading from playlists" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Blender - Videos");
    expect(rows[0]).toHaveTextContent("Playlist · 431 waiting · 17 done · 2 failed");
    expect(rows[1]).toHaveTextContent("Channel · 1 waiting");
  });

  it("asks before cancelling the rest of one, and leaves it when the person changes their mind", async () => {
    const calls = fakeApi({ "GET /api/downloads/batches": () => Response.json([batch()]) });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel the rest of Blender - Videos" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: 'Cancel the 431 videos still waiting from "Blender - Videos"?',
    });
    expect(dialog).toHaveTextContent("The 17 already downloaded stay in your library.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep downloading" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("cancels the rest together once confirmed, and says how many", async () => {
    let left = [batch()];
    const calls = fakeApi({
      "GET /api/downloads/batches": () => Response.json(left),
      [`POST /api/downloads/requests/${ID}/cancel`]: () => {
        left = [];
        return Response.json({ cancelled: 431 });
      },
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel the rest of Blender - Videos" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel 431 videos" }));
    expect(await screen.findByText("Cancelled 431 videos.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      `/api/downloads/requests/${ID}/cancel`,
    ]);
    // Refetched: nothing of it waits any more, so the section goes.
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Downloading from playlists" })).toBeNull();
    });
  });

  it("says one video in the singular", async () => {
    fakeApi({
      "GET /api/downloads/batches": () => Response.json([batch({ waiting: 1, done: 1 })]),
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel the rest of Blender - Videos" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: 'Cancel the 1 video still waiting from "Blender - Videos"?',
    });
    expect(within(dialog).getByRole("button", { name: "Cancel 1 video" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The 1 already downloaded stays in your library.");
  });

  it("shows nothing when no playlist is downloading, or the list can't be read", async () => {
    for (const routes of [{ "GET /api/downloads/batches": () => Response.json([]) }, {}]) {
      const calls = fakeApi(routes);
      const { unmount } = show();
      await waitFor(() => {
        expect(calls.map((c) => c.path)).toContain("/api/downloads/batches");
      });
      expect(screen.queryByRole("region", { name: "Downloading from playlists" })).toBeNull();
      expect(screen.queryByText(/not found/)).toBeNull();
      unmount();
    }
  });
});
