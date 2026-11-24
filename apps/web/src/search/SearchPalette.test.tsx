import type {
  DownloadRequest,
  LibraryEntry,
  LibraryPageEntry,
  PreviewEntry,
} from "@uroboros/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { createAppRouter } from "../router";
import { fakeApi, type Handler } from "../test/fakeApi";

const REQUEST = "0190a3f2-7c1e-7000-8000-0000000000b1";
const BUNNY = "https://youtu.be/aqz-KE-bpKQ";

const entry = (n: number, title: string): LibraryEntry => ({
  id: `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`,
  mediaId: `0190a3f2-7c1e-7000-9000-${String(n).padStart(12, "0")}`,
  title,
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  previewUrl: null,
  profileName: "Best up to 1080p (MP4)",
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

const result = (id: string, title: string): PreviewEntry => ({
  id,
  extractor: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title,
  duration: 465,
  uploader: "Blender Studio",
  thumbnailUrl: null,
});

function request(over: Partial<DownloadRequest>): DownloadRequest {
  return {
    id: REQUEST,
    url: "https://www.youtube.com/results?search_query=spring&sp=EgIQAQ%3D%3D",
    profileId: "0190a3f2-7c1e-7000-8000-0000000000a1",
    state: "probing",
    kind: null,
    title: null,
    groups: [],
    errorKind: null,
    errorMessage: null,
    stderrTail: [],
    createdAt: "2026-11-23T04:00:00.000Z",
    ...over,
  };
}

const page = (entries: LibraryPageEntry[]) => Response.json({ entries, nextCursor: null });

/** The library answers words with `byWords` and links with `byLink`; the page's own list is empty. */
function setup(
  library: { byWords?: LibraryPageEntry[]; byLink?: LibraryEntry[] } = {},
  routes: Record<string, Handler> = {},
) {
  const calls = fakeApi({
    "GET /api/ready": () => Response.json({ status: "ok", failing: [] }),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
    "GET /api/me": () =>
      Response.json({
        id: "0190a3f2-7c1e-7000-8000-000000000001",
        displayName: "Alice",
        email: null,
        role: "member",
        method: "local",
        isBootstrap: false,
      }),
    "GET /api/me/push": () =>
      Response.json({ enabled: false, publicKey: null, devices: [], maxDevices: 10 }),
    "GET /api/format-profiles": () => Response.json([]),
    "GET /api/library": (_init, url) => {
      if (url.searchParams.has("url")) return page(library.byLink ?? []);
      if (url.searchParams.has("q")) return page(library.byWords ?? []);
      return page([]);
    },
    ...routes,
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { calls, router };
}

async function openPalette() {
  await screen.findByRole("navigation", { name: "Primary" });
  await userEvent.keyboard("{Control>}k{/Control}");
  return screen.findByRole("combobox", { name: "Search your library or paste a link" });
}

const options = () =>
  within(screen.getByRole("listbox", { name: "Results" }))
    .queryAllByRole("option")
    .map((o) => o.textContent);

afterEach(() => {
  localStorage.clear();
});

describe("the search palette", () => {
  it("opens with Ctrl+K or ⌘K, focused, and the same keys close it", async () => {
    setup();
    const field = await openPalette();
    expect(field).toHaveFocus();
    expect(
      screen.getByText("Search your library, or paste a link to download it."),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog", { name: "Search or download" })).toBeInTheDocument();
  });

  it("leaves another open dialog alone", async () => {
    setup();
    await screen.findByRole("navigation", { name: "Primary" });
    const [add] = screen.getAllByRole("button", { name: "Add" });
    if (add === undefined) throw new Error("no Add button");
    await userEvent.click(add);
    await userEvent.click(await screen.findByRole("button", { name: "Download" }));
    await screen.findByRole("dialog", { name: "Download a link" });
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Search or download" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Download a link" })).toBeInTheDocument();
  });

  it("searches the library as it is typed in, and opens a match or all of them", async () => {
    const bunny = entry(1, "Big Buck Bunny");
    const { calls, router } = setup({ byWords: [bunny, entry(2, "Bunny bloopers")] });
    const field = await openPalette();
    await userEvent.type(field, "bunny");
    expect(await screen.findByRole("group", { name: "In your library" })).toBeInTheDocument();
    expect(options()).toEqual([
      expect.stringContaining("Big Buck Bunny"),
      expect.stringContaining("Bunny bloopers"),
      "See all results for “bunny” in your library",
      "Search YouTube for “bunny”",
    ]);
    const asked = calls.filter((c) => c.path === "/api/library").length;
    expect(asked).toBeGreaterThan(1);
    // The first row is active; the arrows move it, and the field names it.
    const first = screen.getAllByRole("option")[0];
    expect(field).toHaveAttribute("aria-activedescendant", first?.id);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.href).toBe("/?q=bunny");
    });
    expect(screen.queryByRole("dialog", { name: "Search or download" })).not.toBeInTheDocument();

    await userEvent.type(await openPalette(), "bunny");
    await screen.findByRole("group", { name: "In your library" });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/library/${bunny.id}`);
    });
  });

  it("shows where a match was said, and opens the video at that moment", async () => {
    const lecture: LibraryPageEntry = {
      ...entry(3, "Lecture"),
      match: {
        in: "captions",
        snippet: [
          { text: "and then the ", mark: false },
          { text: "dragon", mark: true },
        ],
        start: 30.4,
      },
    };
    const { router } = setup({ byWords: [lecture] });
    await userEvent.type(await openPalette(), "dragon");
    await screen.findByRole("group", { name: "In your library" });
    expect(options()[0]).toContain("Captions · 0:30");
    expect(options()[0]).toContain("and then the dragon");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.href).toBe(`/library/${lecture.id}?t=30`);
    });
  });

  it("asks for 3 characters before it searches the library", async () => {
    const asked: string[] = [];
    setup(
      {},
      {
        "GET /api/library": (_init, url) => {
          const q = url.searchParams.get("q");
          if (q !== null) asked.push(q);
          return page([]);
        },
      },
    );
    await userEvent.type(await openPalette(), "ab");
    expect(
      await screen.findByText("Type at least 3 characters to search your library."),
    ).toBeInTheDocument();
    expect(options()).toEqual(["Search YouTube for “ab”"]);
    expect(asked).toEqual([]);
  });

  it("searches YouTube when the library has nothing, and downloads results one by one", async () => {
    let polls = 0;
    const { calls } = setup(
      {},
      {
        "POST /api/downloads/search": () => Response.json(request({}), { status: 202 }),
        [`GET /api/downloads/requests/${REQUEST}`]: () => {
          polls++;
          return Response.json(
            request({
              state: "choosing",
              kind: "playlist",
              title: "spring",
              groups: [
                {
                  name: "YouTube",
                  url: null,
                  ticked: false,
                  truncated: false,
                  entries: [
                    result("WhWc3b3KhnY", "Spring"),
                    result("_cMxraX_5RE", "Sprite Fright"),
                  ],
                },
              ],
            }),
          );
        },
        [`POST /api/downloads/requests/${REQUEST}/queue`]: (init) => {
          // The first result is new; the second is one the person already has.
          const fresh = typeof init?.body === "string" && init.body.includes("WhWc3b3KhnY");
          return Response.json({ queued: fresh ? 1 : 0, skipped: fresh ? 0 : 1 });
        },
      },
    );
    const field = await openPalette();
    await userEvent.type(field, "spring");
    expect(
      await screen.findByText("Nothing in your library matches “spring”."),
    ).toBeInTheDocument();
    expect(options()).toEqual(["Search YouTube for “spring”"]);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("group", { name: "On YouTube" })).toBeInTheDocument();
    expect(polls).toBeGreaterThan(0);
    expect(calls.find((c) => c.path === "/api/downloads/search")?.body).toEqual({
      query: "spring",
    });
    expect(options()).toEqual([
      expect.stringContaining("Spring"),
      expect.stringContaining("Sprite Fright"),
    ]);

    await userEvent.keyboard("{Enter}");
    expect(
      await within(screen.getAllByRole("option")[0] as HTMLElement).findByText("Queued"),
    ).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(
      await within(screen.getAllByRole("option")[1] as HTMLElement).findByText("In your library"),
    ).toBeInTheDocument();
    expect(screen.getByText("Already in your library")).toBeInTheDocument();
    const queued = calls.filter((c) => c.path === `/api/downloads/requests/${REQUEST}/queue`);
    expect(queued.map((c) => c.body)).toEqual([
      { entryIds: ["WhWc3b3KhnY"] },
      { entryIds: ["_cMxraX_5RE"] },
    ]);
    // Still open, for more.
    expect(screen.getByRole("dialog", { name: "Search or download" })).toBeInTheDocument();
  });

  it("shows a pasted link's video when the library has it", async () => {
    const bunny = entry(1, "Big Buck Bunny");
    const { calls } = setup({ byLink: [bunny] });
    await userEvent.type(await openPalette(), BUNNY);
    expect(await screen.findByRole("group", { name: "In your library" })).toBeInTheDocument();
    expect(options()).toEqual([expect.stringContaining("Big Buck Bunny")]);
    const lookup = calls.find((c) => c.path === "/api/library" && c.body === undefined);
    expect(lookup).toBeDefined();
  });

  it("offers to download a link the library doesn't have, at once or with a format", async () => {
    const { calls } = setup(
      { byLink: [] },
      {
        "POST /api/downloads": () =>
          Response.json(request({ state: "queued", title: "Big Buck Bunny", url: BUNNY }), {
            status: 202,
          }),
      },
    );
    const field = await openPalette();
    await userEvent.type(field, `  ${BUNNY}  `);
    expect(await screen.findByText("That video isn’t in your library yet.")).toBeInTheDocument();
    expect(options()).toEqual(["Download this link", "Choose a format…"]);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Download a link" });
    expect(within(dialog).getByRole("textbox", { name: "Link" })).toHaveValue(BUNNY);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await userEvent.type(await openPalette(), BUNNY);
    await screen.findByText("That video isn’t in your library yet.");
    await userEvent.keyboard("{Enter}");
    // The toast names what was queued (sonner's store outlives a test, so "Queued" alone may be
    // an earlier test's).
    expect(await screen.findByText("Big Buck Bunny")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST" && c.path === "/api/downloads")).toEqual([
      { method: "POST", path: "/api/downloads", body: { url: BUNNY } },
    ]);
    expect(screen.queryByRole("dialog", { name: "Search or download" })).not.toBeInTheDocument();
  });
});
