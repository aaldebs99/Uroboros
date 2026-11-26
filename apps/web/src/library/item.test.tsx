import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID as ID, itemFixture as item } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { useProgressReporter } from "./useProgressReporter";

// jsdom plays nothing; these pages are about a browser that plays the original.
vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));

vi.mock("./Player", () => import("@/test/fakePlayer"));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ItemPage", () => {
  beforeEach(() => undefined);

  it("shows the video's details and plays from where the person left off", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByRole("heading", { name: "Big Buck Bunny" })).toBeInTheDocument();
    expect(screen.getByText(/2008-05-20/)).toBeInTheDocument();
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-src", item.streamUrl);
    expect(player).toHaveAttribute("data-start", "42");
    expect(player).toHaveAttribute("data-subs", "en");
    // Opened from outside the app (this router keeps no trail), the way back is the Library.
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/");
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    expect(screen.getByRole("button", { name: "less" })).toBeInTheDocument();
  });

  it("plays from a search match's moment rather than where the person left off", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} startAt={754} />);
    expect(await screen.findByTestId("player")).toHaveAttribute("data-start", "754");
  });

  it("seeks when a chapter is chosen", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: /The chase/ }));
    expect(await screen.findByTestId("player")).toHaveAttribute("data-seek", "60");
  });

  it("marks it watched and edits its tags", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      [`PUT /api/library/${ID}/watched`]: () => new Response(null, { status: 204 }),
      [`PUT /api/library/${ID}/tags`]: () => Response.json({ tags: ["movies", "open"] }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Watched" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/watched"))?.body).toEqual({ watched: true });
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Add a tag" }), "Open{Enter}");
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/tags"))?.body).toEqual({
        tags: ["movies", "open"],
      });
    });
  });
});

describe("ItemPage Keep", () => {
  it("toggles Keep on an entry from a subscription", async () => {
    const fromSub = {
      ...item,
      subscription: { id: "0190a3f2-7c1e-7000-8000-0000000000aa", title: "Blender" },
    };
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(fromSub),
      [`PUT /api/library/${ID}/kept`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Keep" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/kept"))?.body).toEqual({ kept: true });
    });
  });

  it("shows its actions as icon buttons, each named in a tooltip", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    const share = await screen.findByRole("button", { name: "Share" });
    for (const name of ["Save to playlist", "Share", "Remove"]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent("");
    }
    expect(screen.getByRole("link", { name: "Save" })).toHaveTextContent("");
    await userEvent.hover(share);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Share");
  });

  it("fetches the video's SponsorBlock segments again when asked", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () =>
        Response.json({ ...item, sponsorSegmentsRefetchable: true }),
      [`POST /api/library/${ID}/skip-segments/refetch`]: () => new Response(null, { status: 202 }),
    });
    await renderInRouter(
      <>
        <ItemPage entryId={ID} />
        <Toaster />
      </>,
    );
    const refetch = await screen.findByRole("button", { name: "Refetch SponsorBlock segments" });
    expect(refetch).toHaveTextContent("");
    await userEvent.click(refetch);
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.method === "POST" && c.path === `/api/library/${ID}/skip-segments/refetch`,
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("Fetching SponsorBlock segments")).toBeInTheDocument();
  });

  it("offers no refetch on a video with no SponsorBlock segments to fetch", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await screen.findByRole("button", { name: "Share" });
    expect(screen.queryByRole("button", { name: "Refetch SponsorBlock segments" })).toBeNull();
  });

  it("links the URLs in the description, opening them in a new tab", async () => {
    fakeApi({
      [`GET /api/library/${ID}`]: () =>
        Response.json({ ...item, description: "Support us: https://blender.org/fund. Thanks" }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    const link = await screen.findByRole("link", { name: "https://blender.org/fund" });
    expect(link).toHaveAttribute("href", "https://blender.org/fund");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows no Keep for an entry no subscription brought", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await screen.findByRole("switch", { name: "Watched" });
    expect(screen.queryByRole("switch", { name: "Keep" })).not.toBeInTheDocument();
  });
});

describe("ItemPage suggestions", () => {
  it("suggests the rest of the library beside the player, without the video playing", async () => {
    const other = { ...item, id: "0190a3f2-7c1e-7000-8000-0000000000d1", title: "Sintel" };
    fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      "GET /api/library": () => Response.json({ entries: [item, other], nextCursor: null }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    const aside = await screen.findByRole("complementary", { name: "Suggestions" });
    const link = await within(aside).findByRole("link", { name: /Sintel/ });
    expect(link).toHaveAttribute("href", `/library/${other.id}`);
    expect(within(aside).queryByRole("link", { name: /Big Buck Bunny/ })).not.toBeInTheDocument();
  });
});

describe("ItemPage actions", () => {
  it("links each tag to the library filtered by it, and removes the entry after asking", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(item),
      [`DELETE /api/library/${ID}`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByRole("link", { name: "movies" })).toHaveAttribute(
      "href",
      "/?tag=movies",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });
});

describe("ItemPage editing an upload", () => {
  const upload = {
    ...item,
    origin: "upload",
    profileName: null,
    webpageUrl: null,
    channelKey: null,
    channel: "Grandpa",
    description: "Day one",
    editable: true,
  };

  it("lets its uploader change the details and the thumbnail", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(upload),
      [`PATCH /api/library/${ID}/details`]: () =>
        Response.json({ ...upload, title: "Snorkelling", description: null, channel: "Nan" }),
      [`PUT /api/library/${ID}/thumbnail`]: () =>
        Response.json({ ...upload, thumbnailUrl: `/api/library/${ID}/thumbnail?v=12345678` }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit details" });
    const title = within(dialog).getByLabelText("Title");
    expect(title).toHaveValue("Big Buck Bunny");
    await userEvent.clear(title);
    await userEvent.type(title, "Snorkelling");
    await userEvent.clear(within(dialog).getByLabelText("Description"));
    const creator = within(dialog).getByLabelText("Creator");
    await userEvent.clear(creator);
    await userEvent.type(creator, "Nan");
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "cover.png", {
      type: "image/png",
    });
    await userEvent.upload(within(dialog).getByLabelText("Choose a thumbnail"), image);
    expect(await within(dialog).findByAltText("The new thumbnail")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit details" })).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      title: "Snorkelling",
      description: null,
      creator: "Nan",
    });
    expect(calls.some((c) => c.method === "PUT" && c.path.endsWith("/thumbnail"))).toBe(true);
  });

  it("refuses a blank title and an image over 5 MiB", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(upload) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit details" });
    await userEvent.clear(within(dialog).getByLabelText("Title"));
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await userEvent.upload(within(dialog).getByLabelText("Choose a thumbnail"), big);
    expect(await within(dialog).findByText(/up to 5 MiB/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Give it a title.")).toBeInTheDocument();
  });

  it("warns that removing it deletes the upload", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(upload) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/an upload can't be downloaded again/i)).toBeInTheDocument();
  });

  it("offers no editing on a downloaded video", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await screen.findByRole("heading", { name: "Big Buck Bunny" });
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });
});

describe("useProgressReporter", () => {
  it("reports at most every 10 seconds, and at once on pause", () => {
    vi.useFakeTimers();
    const report = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useProgressReporter(report));
    act(() => {
      result.current.onTime(1, 100);
      result.current.onTime(2, 100);
    });
    expect(report).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
      result.current.onTime(6, 100);
    });
    expect(report).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(6000);
      result.current.onTime(12, 100);
    });
    expect(report).toHaveBeenCalledTimes(2);
    act(() => {
      result.current.onPause(13, 100);
    });
    expect(report).toHaveBeenLastCalledWith(13, 100);
    expect(report).toHaveBeenCalledTimes(3);
  });
});
