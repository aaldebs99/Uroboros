import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { LibraryGrid } from "./LibraryGrid";
import { PlaylistPage } from "./PlaylistPage";
import { PlaylistsPage } from "./PlaylistsPage";

vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));
vi.mock("./Player", () => ({
  Player: (props: { onEnded: () => void }) => (
    <button type="button" onClick={props.onEnded}>
      end the video
    </button>
  ),
}));

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const MANUAL = id(900);
const YOUTUBE = id(901);

const entry = (n: number) => ({
  id: id(n),
  mediaId: id(n + 500),
  title: `Video ${String(n)}`,
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  previewUrl: null,
  profileName: "Best available",
  origin: "download",
  sizeBytes: 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: null,
  tags: [],
  kept: false,
  subscription: null,
  channelKey: null,
});

const item = (n: number, playlists: { id: string; name: string }[] = []) => ({
  ...entry(n),
  description: null,
  chapters: [],
  skipSegments: [],
  skipSegmentsRefetchable: false,
  subtitles: [],
  streamUrl: `/api/library/${id(n)}/stream`,
  webpageUrl: null,
  sources: [],
  playlists,
  videoCodec: "h264",
  audioCodec: "aac",
  playbackUrl: `/api/library/${id(n)}/playback`,
  videoCodecs: null,
  audioCodecs: null,
  width: null,
  height: null,
  qualities: [],
  sharedBy: null,
  editable: false,
});

const summary = (over: Record<string, unknown>) => ({
  id: MANUAL,
  kind: "manual",
  name: "Road trip",
  count: 2,
  coverThumbnailUrl: null,
  url: null,
  updatedAt: "2026-11-23T10:00:00.000Z",
  ...over,
});
const detail = (over: Record<string, unknown>) => ({ description: null, ...summary(over) });

const page = (...ns: number[]) => Response.json({ entries: ns.map(entry), nextCursor: null });
const ok = () => new Response(null, { status: 204 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playlists", () => {
  it("lists manual playlists first, then YouTube ones, each marked", async () => {
    fakeApi({
      "GET /api/playlists": () =>
        Response.json([
          summary({}),
          summary({ id: YOUTUBE, kind: "youtube", name: "Shorts", url: "https://yt/p" }),
        ]),
    });
    await renderInRouter(<PlaylistsPage />);
    const mine = (await screen.findByText("Road trip")).closest("li") as HTMLElement;
    expect(within(mine).getByText(/Playlist · 2 videos/)).toBeInTheDocument();
    const yt = screen.getByText("Shorts").closest("li") as HTMLElement;
    expect(within(yt).getByText(/From YouTube · 2 videos/)).toBeInTheDocument();
  });

  it("makes a new playlist", async () => {
    const calls = fakeApi({
      "GET /api/playlists": () => Response.json([]),
      "POST /api/playlists": () => Response.json(detail({ name: "Cartoons" }), { status: 201 }),
    });
    await renderInRouter(<PlaylistsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "New playlist" }));
    await userEvent.type(screen.getByLabelText("Name"), "Cartoons");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        name: "Cartoons",
        description: null,
      });
    });
  });

  it("reorders and removes videos of a manual playlist", async () => {
    const calls = fakeApi({
      [`GET /api/playlists/${MANUAL}`]: () => Response.json(detail({})),
      "GET /api/library": () => page(1, 2),
      [`POST /api/playlists/${MANUAL}/items/${id(1)}/move`]: ok,
      [`DELETE /api/playlists/${MANUAL}/items/${id(2)}`]: ok,
    });
    await renderInRouter(<PlaylistPage playlistId={MANUAL} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit order" }));
    await userEvent.click(screen.getByRole("button", { name: "Move Video 1 down" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/move"))?.body).toEqual({ position: 1 });
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove Video 2 from the playlist" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
    expect(screen.queryByRole("button", { name: "Save as my playlist" })).not.toBeInTheDocument();
  });

  it("offers Save as my playlist on a YouTube playlist, and no editing", async () => {
    const calls = fakeApi({
      [`GET /api/playlists/${YOUTUBE}`]: () =>
        Response.json(
          detail({ id: YOUTUBE, kind: "youtube", name: "Shorts", url: "https://yt/p" }),
        ),
      "GET /api/library": () => page(1),
      [`POST /api/playlists/${YOUTUBE}/copy`]: () =>
        Response.json(detail({ name: "Shorts" }), { status: 201 }),
    });
    await renderInRouter(<PlaylistPage playlistId={YOUTUBE} />);
    await userEvent.click(await screen.findByRole("button", { name: "Save as my playlist" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith("/copy"))).toBe(true);
    });
    expect(screen.queryByRole("button", { name: "Edit order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
  });

  it("saves a video to a playlist from its tile", async () => {
    const calls = fakeApi({
      "GET /api/library": () => page(1),
      "GET /api/playlists": () => Response.json([summary({})]),
      [`GET /api/library/${id(1)}`]: () => Response.json(item(1)),
      [`POST /api/playlists/${MANUAL}/items`]: ok,
    });
    await renderInRouter(<LibraryGrid filters={{}} empty={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Video 1" }));
    // jsdom is a phone: the ⋮ menu is a bottom sheet of buttons.
    await userEvent.click(await screen.findByRole("button", { name: "Save to playlist" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Road trip" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/items"))?.body).toEqual({ entryIds: [id(1)] });
    });
  });

  it("plays a playlist in order: Up next beside the player, then the next video", async () => {
    const calls = fakeApi({
      [`GET /api/playlists/${MANUAL}`]: () => Response.json(detail({})),
      "GET /api/library": () => page(1, 2),
      [`GET /api/library/${id(1)}`]: () => Response.json(item(1)),
      [`GET /api/library/${id(2)}`]: () => Response.json(item(2)),
    });
    const root = createRootRoute({ component: Outlet });
    const watch = createRoute({
      getParentRoute: () => root,
      path: "/library/$entryId",
      component: function Watch() {
        const entryId = watch.useParams({ select: (p: { entryId: string }) => p.entryId });
        const list = watch.useSearch({ select: (q: { list?: string }) => q.list });
        return (
          <ItemPage
            entryId={entryId}
            queue={list === undefined ? null : { kind: "playlist", id: list }}
          />
        );
      },
      validateSearch: (s: Record<string, unknown>) => ({
        list: typeof s.list === "string" ? s.list : undefined,
      }),
    });
    const router = createRouter({
      routeTree: root.addChildren([watch]),
      history: createMemoryHistory({ initialEntries: [`/library/${id(1)}?list=${MANUAL}`] }),
    });
    await router.load();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const upNext = await screen.findByRole("complementary", { name: "Up next" });
    expect(await within(upNext).findByText("Video 2")).toBeInTheDocument();
    expect(within(upNext).getByText("Video 1").closest("a")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(await screen.findByRole("button", { name: "end the video" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/api/library/${id(2)}`)).toBe(true);
    });
  });
});
