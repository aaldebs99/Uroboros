import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadKeys } from "@/api/downloads";
import { exportsKey } from "@/api/exports";
import { subscriptionKeys } from "@/api/subscriptions";
import { itemKey, useLibraryPages } from "@/api/library";
import { followLiveEvents, type LiveMessage } from "@/api/liveEvents";
import { Toaster } from "@/components/ui/sonner";
import { downloadFixture } from "@/test/activity";
import { fakeApi } from "@/test/fakeApi";
import { itemFixture } from "@/test/subscriptions";

import { LiveEventsProvider } from "./LiveEvents";

vi.mock("@/api/liveEvents", () => ({ followLiveEvents: vi.fn() }));

const ENTRY = "0190a3f2-7c1e-7000-8000-0000000000c1";

afterEach(() => {
  vi.mocked(followLiveEvents).mockReset();
});

/** The provider on a client holding the entry and the person's copies; returns its stream. */
function renderLive(children?: ReactNode) {
  let deliver: (m: LiveMessage) => void = () => undefined;
  vi.mocked(followLiveEvents).mockImplementation((onMessage) => {
    deliver = onMessage;
    return () => undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(itemKey(ENTRY), { id: ENTRY });
  client.setQueryData(exportsKey, []);
  render(
    <QueryClientProvider client={client}>
      <LiveEventsProvider>
        <Toaster />
        {children}
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    deliver: (m: LiveMessage) => {
      act(() => {
        deliver(m);
      });
    },
  };
}

describe("LiveEventsProvider", () => {
  it("fetches the queue, the playlists still downloading and those to pick again when the person's requests change", () => {
    // One `requests` event covers a whole playlist discarded, or its rest cancelled together.
    const { client, deliver } = renderLive();
    const keys = [
      downloadKeys.ready,
      downloadKeys.batches,
      downloadKeys.list(false),
      downloadKeys.active,
    ];
    for (const key of keys) client.setQueryData(key, []);
    deliver({ kind: "event", event: { type: "requests" } });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("fetches the playlists still downloading again after a gap, when their counts may have moved unheard", () => {
    const { client, deliver } = renderLive();
    client.setQueryData(downloadKeys.batches, []);
    deliver({ kind: "gap" });
    expect(client.getQueryState(downloadKeys.batches)?.isInvalidated).toBe(true);
  });

  it("fetches the playlists still downloading again when a download changes state", () => {
    const { client, deliver } = renderLive();
    client.setQueryData(downloadKeys.batches, []);
    deliver({
      kind: "event",
      event: { type: "state", download: downloadFixture({ state: "done" }) },
    });
    expect(client.getQueryState(downloadKeys.batches)?.isInvalidated).toBe(true);
  });

  it("fetches a subscription's activity again when one of its downloads changes state", () => {
    const { client, deliver } = renderLive();
    const DOWNLOAD = "0190a3f2-7c1e-7000-8000-0000000000d1";
    const holding = subscriptionKeys.items("0190a3f2-7c1e-7000-8000-0000000000a1", null);
    const other = subscriptionKeys.items("0190a3f2-7c1e-7000-8000-0000000000a2", null);
    const page = (downloadId: string | null) => ({
      pages: [{ items: [itemFixture({ downloadId })], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(holding, page(DOWNLOAD));
    client.setQueryData(other, page(null));
    deliver({
      kind: "event",
      event: { type: "state", download: downloadFixture({ id: DOWNLOAD, state: "done" }) },
    });
    expect(client.getQueryState(holding)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("fetches the entry and the person's copies again after a SponsorBlock refetch, and says how it went", async () => {
    const { client, deliver } = renderLive();
    deliver({
      kind: "event",
      event: {
        type: "skips",
        entryId: ENTRY,
        found: 3,
        error: null,
        total: 3,
        highlight: false,
        quiet: false,
      },
    });
    // A copy cut from the old segments is no longer current: Save must not hand it out.
    expect(client.getQueryState(exportsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(itemKey(ENTRY))?.isInvalidated).toBe(true);
    expect(await screen.findByText("Found 3 SponsorBlock segments")).toBeInTheDocument();
  });

  it("fetches the entry again after a quiet refresh, without a toast", async () => {
    const { client, deliver } = renderLive();
    deliver({
      kind: "event",
      event: {
        type: "skips",
        entryId: ENTRY,
        found: 2,
        error: null,
        total: 2,
        highlight: false,
        quiet: true,
      },
    });
    expect(client.getQueryState(itemKey(ENTRY))?.isInvalidated).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Found 2 SponsorBlock segments")).toBeNull();
  });
});

/** The library's lists: the first page, the grid's pages, the palette's lookup, the channels. */
const LISTS = [
  ["api", "library"],
  ["api", "library", "pages", {}],
  ["api", "library", "lookup", { q: "bunny" }],
  ["api", "library", "channels"],
] as const;

const entry = (n: number) => ({
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
});

const finished = (n: number): LiveMessage => ({
  kind: "event",
  event: {
    type: "state",
    download: downloadFixture({
      id: `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`,
      state: "done",
    }),
  },
});

/** The grid's titles, as the library page shows them. */
function Titles() {
  const pages = useLibraryPages({});
  return (
    <ul>
      {pages.data?.pages
        .flatMap((p) => p.entries)
        .map((e) => (
          <li key={e.id}>{e.title}</li>
        ))}
    </ul>
  );
}

describe("LiveEventsProvider and the library", () => {
  /** Caches the library's lists; returns which of them are marked to be fetched again. */
  function cacheLists(client: QueryClient) {
    for (const key of LISTS) client.setQueryData(key, {});
    return () => LISTS.map((key) => client.getQueryState(key)?.isInvalidated);
  }

  it("fetches its lists again when a download is done, not while it runs, and leaves entry pages", () => {
    const { client, deliver } = renderLive();
    const marked = cacheLists(client);
    deliver({
      kind: "event",
      event: { type: "state", download: downloadFixture({ state: "running" }) },
    });
    expect(marked()).toEqual([false, false, false, false]);
    deliver(finished(1));
    expect(marked()).toEqual([true, true, true, true]);
    expect(client.getQueryState(itemKey(ENTRY))?.isInvalidated).toBe(false);
  });

  it("fetches them again when an upload of the person's is filed", () => {
    const { client, deliver } = renderLive();
    const marked = cacheLists(client);
    deliver({ kind: "event", event: { type: "library" } });
    expect(marked()).toEqual([true, true, true, true]);
    expect(client.getQueryState(itemKey(ENTRY))?.isInvalidated).toBe(false);
  });

  it("fetches them again after a gap, when a finish may have gone by unheard", () => {
    const { client, deliver } = renderLive();
    const marked = cacheLists(client);
    deliver({ kind: "gap" });
    expect(marked()).toEqual([true, true, true, true]);
  });

  it("asks again for a download that finishes while the last one's fetch is under way", async () => {
    let shelf = [entry(1)];
    let hold: Promise<void> | null = null;
    let release: () => void = () => undefined;
    const calls = fakeApi({
      "GET /api/library": async () => {
        const entries = [...shelf];
        if (hold !== null) await hold;
        return Response.json({ entries, nextCursor: null });
      },
    });
    const { deliver } = renderLive(<Titles />);
    expect(await screen.findByText("Video 1")).toBeInTheDocument();
    hold = new Promise((resolve) => {
      release = resolve;
    });
    deliver(finished(1));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    // The second video lands after that fetch went out: its answer can't have it.
    shelf = [entry(2), entry(1)];
    hold = null;
    deliver(finished(2));
    release();
    expect(await screen.findByText("Video 2")).toBeInTheDocument();
  });
});
