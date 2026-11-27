import type { LibraryItem } from "@uroboros/contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi, type Handler } from "@/test/fakeApi";
import { ITEM_ID as ID, itemFixture } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { changedDetails } from "./OwnDetailsForm";

/**
 * Edit details on a video of the person's that they didn't upload (docs/library.md#your-own-details):
 * a title, description and channel of their own, for them alone, until they reset them.
 */

vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));
vi.mock("./Player", () => import("@/test/fakePlayer"));

// The player is a lazy chunk: loaded here, a test's wait covers rendering it, not loading it.
beforeAll(async () => {
  await import("./Player");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mine: LibraryItem = { ...itemFixture, personalEditable: true };
const edited: LibraryItem = {
  ...mine,
  title: "My title",
  channel: "Favorites",
  edited: true,
  original: { title: "Big Buck Bunny", description: "The site's words", channel: "Blender" },
};
const channel = (name: string) => ({
  key: btoa(name),
  name,
  extractor: "youtube",
  count: 1,
  latestUpload: null,
  coverThumbnailUrl: null,
});

async function openEditor(shown: LibraryItem, routes: Record<string, Handler> = {}) {
  const calls = fakeApi({
    [`GET /api/library/${ID}`]: () => Response.json(shown),
    "GET /api/library/channels": () =>
      Response.json([channel("Blender"), channel("Favorites"), channel("Fishing")]),
    ...routes,
  });
  await renderInRouter(
    <>
      <ItemPage entryId={ID} />
      <Toaster />
    </>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit details" });
  return { calls, dialog };
}

const saved = (over: Partial<LibraryItem>) => () =>
  Response.json({ ...mine, edited: true, ...over });

describe("editing a downloaded video's details for oneself", () => {
  it("offers a title, description and channel, and no thumbnail", async () => {
    const { dialog } = await openEditor(mine);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Big Buck Bunny");
    expect(within(dialog).getByRole("combobox", { name: "Channel" })).toHaveValue("Blender");
    expect(within(dialog).queryByLabelText("Choose a thumbnail")).toBeNull();
    expect(within(dialog).getByText(/only you see them/i)).toBeInTheDocument();
  });

  it("sends only what changed", async () => {
    const { calls, dialog } = await openEditor(mine, {
      [`PATCH /api/library/${ID}/details`]: saved({ title: "Bunny" }),
    });
    const title = within(dialog).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Bunny");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit details" })).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "Bunny" });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("suggests the person's channels, and keeps a name of a new one", async () => {
    const { calls, dialog } = await openEditor(mine, {
      [`PATCH /api/library/${ID}/details`]: saved({ channel: "Fiddling" }),
    });
    const field = within(dialog).getByRole("combobox", { name: "Channel" });
    await userEvent.clear(field);
    await userEvent.type(field, "Fi");
    const listed = within(screen.getByRole("listbox", { name: "Channel" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(listed).toEqual(["Fishing"]);
    await userEvent.type(field, "ddling");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ creator: "Fiddling" });
    });
  });

  it("names the site's details while one's own show, and resets to them", async () => {
    const { calls, dialog } = await openEditor(edited, {
      [`DELETE /api/library/${ID}/details`]: () => new Response(null, { status: 204 }),
    });
    expect(within(dialog).getByText("On the site: Big Buck Bunny")).toBeInTheDocument();
    expect(within(dialog).getByText("On the site: Blender")).toBeInTheDocument();
    const gets = () => calls.filter((c) => c.method === "GET" && c.path === `/api/library/${ID}`);
    const before = gets().length;
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reset to the site's details" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit details" })).not.toBeInTheDocument();
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    await waitFor(() => {
      expect(gets().length).toBeGreaterThan(before);
    });
  });

  it("offers no reset until one's own details show", async () => {
    const { dialog } = await openEditor(mine);
    expect(within(dialog).queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("says the uploader's details on someone else's upload", async () => {
    const { dialog } = await openEditor({ ...edited, origin: "upload", profileName: null });
    expect(
      within(dialog).getByRole("button", { name: "Reset to the uploader's details" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("From the uploader: Big Buck Bunny")).toBeInTheDocument();
  });
});

describe("changedDetails", () => {
  const shown = { title: "x".repeat(250), description: "Words ", channel: "Blender" };
  it("sends nothing left as it is, a site's long title and stray spaces included", () => {
    expect(
      changedDetails(shown, { title: shown.title, description: " Words", channel: "Blender " }),
    ).toEqual({});
  });

  it("sends each change, a cleared description as none", () => {
    expect(changedDetails(shown, { title: "T", description: "  ", channel: "Fishing" })).toEqual({
      title: "T",
      description: null,
      creator: "Fishing",
    });
  });
});
