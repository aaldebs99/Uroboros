import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "../library/ItemPage";
import { expiresAtFor } from "./expiry";
import { ShareDialog } from "./ShareDialog";
import { SharedByMe } from "./SharedByMe";
import { SharedPage } from "./SharedPage";
import { SharedPlaylistPage } from "./SharedPlaylistPage";

vi.mock("../library/playable", () => ({ canPlayOriginal: () => true, hasNativeHls: () => false }));
vi.mock("../library/Player", () => ({ Player: () => <div data-testid="player" /> }));

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const ENTRY = id(1);
const BOB = id(50);
const SHARE = id(70);
const PLAYLIST = id(80);

const state = (over: Record<string, unknown> = {}) => ({
  kind: "entry",
  id: ENTRY,
  title: "Holiday",
  thumbnailUrl: null,
  people: null,
  link: null,
  updatedAt: null,
  ...over,
});
const link = (over: Record<string, unknown> = {}) => ({
  code: "AbCdEfGhIjKlMnOpQrStUv",
  path: "/s/AbCdEfGhIjKlMnOpQrStUv",
  allowDownload: false,
  expiresAt: null,
  expired: false,
  ...over,
});
const directory = {
  users: [{ id: BOB, name: "Bob", handle: "bob" }],
  groups: [{ name: "family", members: 3 }],
};

const entry = (n: number) => ({
  id: id(n),
  mediaId: id(n + 500),
  title: `Video ${String(n)}`,
  channel: "Blender",
  uploadDate: null,
  duration: 60,
  thumbnailUrl: null,
  profileName: "Best available",
  sizeBytes: 10,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: null,
  tags: [],
  kept: false,
  subscription: null,
  channelKey: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the share dialog", () => {
  it("shares with a person and a group", async () => {
    const calls = fakeApi({
      [`GET /api/shares/entry/${ENTRY}`]: () => Response.json(state()),
      "GET /api/directory": () => Response.json(directory),
      [`PUT /api/shares/entry/${ENTRY}/people`]: () =>
        Response.json(
          state({
            people: {
              people: [{ kind: "user", id: BOB, name: "Bob", handle: "bob" }],
              expiresAt: null,
              expired: false,
            },
          }),
        ),
    });
    await renderInRouter(
      <ShareDialog kind="entry" id={ENTRY} title="Holiday" open onOpenChange={() => undefined} />,
    );
    await userEvent.type(await screen.findByLabelText("Add people or groups"), "bo");
    await userEvent.click(await screen.findByRole("button", { name: /Add Bob/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        people: [{ kind: "user", id: BOB }],
        expiresAt: null,
      });
    });
    await userEvent.type(screen.getByLabelText("Add people or groups"), "fam");
    await userEvent.click(await screen.findByRole("button", { name: /Add family/ }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({
        people: [
          { kind: "user", id: BOB },
          { kind: "group", name: "family" },
        ],
        expiresAt: null,
      });
    });
  });

  it("turns the public link on and shows it with Copy", async () => {
    let current = state();
    const calls = fakeApi({
      [`GET /api/shares/entry/${ENTRY}`]: () => Response.json(current),
      "GET /api/directory": () => Response.json(directory),
      [`PUT /api/shares/entry/${ENTRY}/link`]: (init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          allowDownload: boolean;
        };
        current = state({ link: link({ allowDownload: body.allowDownload }) });
        return Response.json(current);
      },
    });
    await renderInRouter(
      <ShareDialog kind="entry" id={ENTRY} title="Holiday" open onOpenChange={() => undefined} />,
    );
    await userEvent.click(await screen.findByRole("switch", { name: "Public link" }));
    expect(await screen.findByDisplayValue(/\/s\/AbCdEfGhIjKlMnOpQrStUv$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(
      screen.getByText("Anyone with the link can watch, and save what they can play."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Allow downloads" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.path.endsWith("/link")).at(-1)?.body).toEqual({
        allowDownload: true,
        expiresAt: null,
      });
    });
    await userEvent.selectOptions(screen.getByLabelText("Link expires"), "week");
    await waitFor(() => {
      const last = calls.filter((c) => c.path.endsWith("/link")).at(-1)?.body as {
        expiresAt: string | null;
      };
      expect(last.expiresAt).not.toBeNull();
    });
  });
});

describe("expiry choices", () => {
  it("a week is seven days later", () => {
    const now = new Date("2026-11-23T12:00:00.000Z");
    expect(expiresAtFor("week", undefined, now)).toBe("2026-11-30T12:00:00.000Z");
    expect(expiresAtFor("never", undefined, now)).toBeNull();
  });
});

describe("Shared", () => {
  it("lists what is shared with me, with who shared it", async () => {
    fakeApi({
      "GET /api/shared": () =>
        Response.json([
          {
            shareId: SHARE,
            kind: "playlist",
            id: PLAYLIST,
            title: "Alice's picks",
            thumbnailUrl: null,
            count: 3,
            owner: "Alice",
            sharedAt: "2026-11-23T10:00:00.000Z",
            expiresAt: null,
          },
          {
            shareId: id(71),
            kind: "entry",
            id: ENTRY,
            title: "Holiday",
            thumbnailUrl: null,
            count: null,
            owner: "Carol",
            sharedAt: "2026-11-23T09:00:00.000Z",
            expiresAt: null,
          },
        ]),
    });
    await renderInRouter(<SharedPage />);
    const picks = (await screen.findByText("Alice's picks")).closest("li") as HTMLElement;
    expect(within(picks).getByText(/from Alice · 3 videos/)).toBeInTheDocument();
    expect(within(picks).getByRole("link", { name: /Alice's picks/ })).toHaveAttribute(
      "href",
      `/shared/${SHARE}`,
    );
    const holiday = screen.getByText("Holiday").closest("li") as HTMLElement;
    expect(within(holiday).getByRole("link", { name: /Holiday/ })).toHaveAttribute(
      "href",
      `/library/${ENTRY}`,
    );
  });

  it("revokes a link under By me", async () => {
    const calls = fakeApi({
      "GET /api/shares": () => Response.json([state({ link: link({ expired: true }) })]),
      [`DELETE /api/shares/entry/${ENTRY}/link`]: () => new Response(null, { status: 204 }),
      [`DELETE /api/shares/entry/${ENTRY}/people`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<SharedByMe />);
    const row = (await screen.findByText("Holiday")).closest("li") as HTMLElement;
    expect(within(row).getByText("Expired")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    await userEvent.click(await screen.findByRole("button", { name: "Stop sharing" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/link"))).toBe(true);
    });
  });

  it("a shared playlist offers Save as my playlist", async () => {
    const calls = fakeApi({
      [`GET /api/shared/${SHARE}`]: () =>
        Response.json({
          shareId: SHARE,
          kind: "playlist",
          id: PLAYLIST,
          title: "Alice's picks",
          description: null,
          owner: "Alice",
          count: 1,
        }),
      [`GET /api/shared/${SHARE}/entries`]: () =>
        Response.json({ entries: [entry(2)], nextCursor: null }),
      [`POST /api/shared/${SHARE}/save`]: () =>
        Response.json(
          {
            id: id(90),
            kind: "manual",
            name: "Alice's picks",
            count: 1,
            coverThumbnailUrl: null,
            url: null,
            updatedAt: "2026-11-23T10:00:00.000Z",
            description: null,
          },
          { status: 201 },
        ),
    });
    await renderInRouter(<SharedPlaylistPage shareId={SHARE} />);
    expect(await screen.findByText("Video 2")).toBeInTheDocument();
    expect(screen.getByText(/Shared by Alice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save as my playlist" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith("/save"))).toBe(true);
    });
  });

  it("a share that ended says so", async () => {
    fakeApi({});
    await renderInRouter(<SharedPlaylistPage shareId={SHARE} />);
    expect(await screen.findByText("This is no longer shared with you")).toBeInTheDocument();
  });
});

describe("a video someone shared with me", () => {
  const sharedItem = {
    ...entry(1),
    description: null,
    chapters: [],
    subtitles: [],
    streamUrl: `/api/library/${ENTRY}/stream`,
    webpageUrl: null,
    sources: [],
    playlists: [],
    videoCodec: "h264",
    audioCodec: "aac",
    playbackUrl: `/api/library/${ENTRY}/playback`,
    sharedBy: "Alice",
  };

  it("shows who shared it and Add to my library, not the owner's actions", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ENTRY}`]: () => Response.json(sharedItem),
      [`POST /api/library/${ENTRY}/add`]: () => Response.json({ id: id(2) }, { status: 201 }),
    });
    await renderInRouter(<ItemPage entryId={ENTRY} />);
    expect(await screen.findByText("Shared by Alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save to playlist/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Share/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a tag" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to my library" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith("/add"))).toBe(true);
    });
  });
});
