import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { DownloadsPage } from "./DownloadsPage";

const T = "2026-11-22T10:00:00.000Z";
const PID = "0190a3f2-7c1e-7000-8000-0000000000a1";
const member = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Alice",
  email: null,
  role: "member" as const,
  method: "local" as const,
  isBootstrap: false,
};
const admin = { ...member, role: "admin" as const };

const profiles = [
  {
    id: PID,
    name: "Best up to 1080p (MP4)",
    format: "b",
    mergeFormat: "mp4",
    audioOnly: false,
    audioFormat: null,
    extraArgs: [],
    isDefault: true,
    revision: "r1",
  },
];

const download = (over: Record<string, unknown> = {}) => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000d1",
  owner: { id: member.id, displayName: "Alice" },
  url: "https://www.youtube.com/watch?v=a",
  title: "Big Buck Bunny",
  extractor: "youtube",
  videoId: "a",
  profileId: PID,
  fetchKey: "fetch|youtube|a|p|r1",
  state: "running",
  progress: null,
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  attempts: 1,
  createdAt: T,
  startedAt: T,
  finishedAt: null,
  ...over,
});

const entry = (id: string) => ({
  id,
  extractor: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Video ${id}`,
  duration: 61,
  uploader: "Blender",
  thumbnailUrl: null,
});

const choosingRequest = {
  id: "0190a3f2-7c1e-7000-8000-0000000000e1",
  url: "https://www.youtube.com/@BlenderOfficial",
  profileId: PID,
  state: "choosing",
  kind: "channel",
  title: "Blender",
  groups: [
    { name: "Videos", ticked: true, truncated: false, entries: [entry("v1"), entry("v2")] },
    { name: "Shorts", ticked: false, truncated: false, entries: [entry("s1")] },
  ],
  errorKind: null,
  errorMessage: null,
  createdAt: T,
};

/** A stand-in EventSource the test can push messages through. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function api(over: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /api/format-profiles": () => Response.json(profiles),
    "GET /api/downloads": () => Response.json([]),
    ...over,
  });
}

describe("DownloadsPage", () => {
  it("posts a pasted video with the default profile", async () => {
    const calls = api({
      "POST /api/downloads": () =>
        Response.json(
          { ...choosingRequest, state: "probing", kind: null, groups: [] },
          { status: 202 },
        ),
      [`GET /api/downloads/requests/${choosingRequest.id}`]: () =>
        Response.json({ ...choosingRequest, state: "queued", kind: "video", groups: [] }),
    });
    renderWithQuery(<DownloadsPage me={member} requestId={null} />);
    await userEvent.type(await screen.findByLabelText("Link"), "https://www.youtube.com/watch?v=a");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST" && c.path === "/api/downloads")?.body).toEqual({
        url: "https://www.youtube.com/watch?v=a",
      });
    });
  });

  it("previews a channel by tab, Shorts unticked, and queues exactly the ticked videos", async () => {
    const calls = api({
      [`GET /api/downloads/requests/${choosingRequest.id}`]: () => Response.json(choosingRequest),
      [`POST /api/downloads/requests/${choosingRequest.id}/queue`]: () =>
        Response.json({ queued: 2, skipped: 0 }),
    });
    renderWithQuery(<DownloadsPage me={member} requestId={choosingRequest.id} />);
    expect(await screen.findByRole("checkbox", { name: "Video v1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Video s1" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Queue 2 videos" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/queue"))?.body).toEqual({
        entryIds: ["v1", "v2"],
      });
    });
  });

  it("disables queueing when nothing is ticked", async () => {
    api({
      [`GET /api/downloads/requests/${choosingRequest.id}`]: () => Response.json(choosingRequest),
    });
    renderWithQuery(<DownloadsPage me={member} requestId={choosingRequest.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Select none" }));
    expect(screen.getByRole("button", { name: /Queue 0 videos/ })).toBeDisabled();
  });

  it("explains a failure and shows yt-dlp's output on request; Retry calls the route", async () => {
    const failed = download({
      state: "failed",
      errorKind: "private",
      stderrTail: ["ERROR: Private video"],
    });
    const calls = api({
      "GET /api/downloads": () => Response.json([failed]),
      [`POST /api/downloads/${failed.id}/retry`]: () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<DownloadsPage me={member} requestId={null} />);
    expect(await screen.findByText("This video is private.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Details"));
    expect(screen.getByText("ERROR: Private video")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/api/downloads/${failed.id}/retry`)).toBe(true);
    });
  });

  it("cancels a running download", async () => {
    const running = download();
    const calls = api({
      "GET /api/downloads": () => Response.json([running]),
      [`POST /api/downloads/${running.id}/cancel`]: () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<DownloadsPage me={member} requestId={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/api/downloads/${running.id}/cancel`)).toBe(true);
    });
  });

  it("shows the Everyone toggle to admins only", async () => {
    api();
    const { unmount } = renderWithQuery(<DownloadsPage me={member} requestId={null} />);
    await screen.findByLabelText("Link");
    expect(screen.queryByLabelText("Everyone")).not.toBeInTheDocument();
    unmount();
    renderWithQuery(<DownloadsPage me={admin} requestId={null} />);
    expect(await screen.findByLabelText("Everyone")).toBeInTheDocument();
  });

  it("applies live progress to the row waiting on that fetch", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    api({ "GET /api/downloads": () => Response.json([download()]) });
    renderWithQuery(<DownloadsPage me={member} requestId={null} />);
    const row = await screen.findByRole("listitem");
    act(() => {
      FakeEventSource.last?.push({
        type: "progress",
        fetchKey: "fetch|youtube|a|p|r1",
        progress: {
          phase: "downloading",
          percent: 42,
          downloadedBytes: 42,
          totalBytes: 100,
          speed: 1024,
          eta: 30,
        },
      });
    });
    expect(await within(row).findByText(/42%/)).toBeInTheDocument();
  });
});
