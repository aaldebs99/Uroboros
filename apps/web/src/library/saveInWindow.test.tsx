import type { Export } from "@uroboros/contract";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Download } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import type * as InstalledModule from "@/push/installed";
import { ExportsSection } from "@/exports/ExportsSection";
import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID, itemFixture } from "@/test/libraryItem";
import { renderInRouter, renderWithQuery } from "@/test/render";

import { SaveButton } from "./SaveButton";
import { SaveFile } from "./SaveFile";
import { openSave } from "./saveInWindow";
import { EntryTile } from "./VideoTile";

/**
 * Saving from the installed iPhone app (docs/downloads.md#saving-a-file): a link to the file would
 * hand the app's only page to iOS's file view with no way back, so Save opens a window of its own
 * and sends it to a short-lived save link that needs no cookie. Everywhere else Save stays a link.
 */

type Installed = typeof InstalledModule;
const where = vi.hoisted(() => ({ iosApp: false }));
vi.mock("@/push/installed", async (original) => ({
  ...(await original<Installed>()),
  isIos: () => where.iosApp,
  isInstalled: () => where.iosApp,
}));

const SAVE = "/api/public/saves/tok-0123456789abcdefghij";
/** The window `window.open` hands back, in place of a real one. */
function fakeWindow() {
  return { location: { href: "" }, opener: window as unknown, close: vi.fn() };
}
function stubOpen(win: ReturnType<typeof fakeWindow> | null = fakeWindow()) {
  const open = vi.fn(() => win);
  vi.stubGlobal("open", open);
  return { open, win };
}

beforeEach(() => {
  where.iosApp = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openSave", () => {
  it("opens the window inside the tap, then sends it to the link once it is made", async () => {
    const { open, win } = stubOpen();
    let made: (url: string) => void = () => undefined;
    openSave(
      () =>
        new Promise<string>((resolve) => {
          made = resolve;
        }),
    );
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(win?.location.href).toBe("");
    await act(async () => {
      made(SAVE);
      await Promise.resolve();
    });
    expect(win?.location.href).toBe(new URL(SAVE, window.location.origin).href);
    expect(win?.opener).toBeNull();
  });

  it("closes the window and says why when the link can't be made", async () => {
    render(<Toaster />);
    const { win } = stubOpen();
    openSave(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await screen.findByText("Could not reach the server.")).toBeInTheDocument();
    expect(win?.close).toHaveBeenCalled();
  });

  it("says so when no window may open, and leaves the app where it is", async () => {
    render(<Toaster />);
    stubOpen(null);
    const here = window.location.href;
    const link = vi.fn(() => Promise.resolve(SAVE));
    openSave(link);
    expect(await screen.findByText("Couldn't open a window to save the file")).toBeInTheDocument();
    expect(link).not.toHaveBeenCalled();
    expect(window.location.href).toBe(here);
  });
});

describe("SaveButton", () => {
  it("is a plain download link outside the installed iPhone app", () => {
    where.iosApp = false;
    render(
      <SaveButton href="/f" link={() => Promise.resolve(SAVE)} aria-label="Save">
        <Download aria-hidden />
      </SaveButton>,
    );
    const link = screen.getByRole("link", { name: "Save" });
    expect(link).toHaveAttribute("href", "/f");
    expect(link).toHaveAttribute("download");
  });

  it("saves through a window of its own in the installed iPhone app", async () => {
    const { open, win } = stubOpen();
    render(
      <SaveButton href="/f" link={() => Promise.resolve(SAVE)} aria-label="Save">
        <Download aria-hidden />
      </SaveButton>,
    );
    expect(screen.queryByRole("link", { name: "Save" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(open).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(win?.location.href).toContain(SAVE);
    });
  });

  it("opens a URL that needs no session (a public link's) in a new window as it is", () => {
    render(
      <SaveButton href="/api/public/s/abc/items/x/file" aria-label="Download">
        <Download aria-hidden />
      </SaveButton>,
    );
    const link = screen.getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).not.toHaveAttribute("download");
  });
});

describe("Save in the installed iPhone app", () => {
  const copy = (over: Partial<Export>): Export => ({
    id: "0190a3f2-7c1e-7000-8000-0000000000e1",
    entryId: ITEM_ID,
    title: "Big Buck Bunny",
    state: "done",
    progress: null,
    encoder: "libx264",
    error: null,
    sizeBytes: 10,
    keptSeconds: 500,
    cutSeconds: 96,
    createdAt: "2026-11-24T18:00:00.000Z",
    fileUrl: "/api/exports/0190a3f2-7c1e-7000-8000-0000000000e1/file",
    current: true,
    ...over,
  });
  const saveLink = () =>
    Response.json({ url: SAVE, expiresAt: "2026-11-26T20:00:00.000Z" }, { status: 201 });

  it("saves the watch page's file through an entry's save link", async () => {
    const calls = fakeApi({ [`POST /api/library/${ITEM_ID}/save-link`]: saveLink });
    const { win } = stubOpen();
    await renderInRouter(<SaveFile item={{ id: ITEM_ID, sponsorSegments: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(win?.location.href).toContain(SAVE);
    });
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/save-link"))).toBe(true);
  });

  it("saves a copy without sponsors through the copy's save link", async () => {
    const made = copy({});
    const calls = fakeApi({
      "GET /api/exports": () => Response.json([made]),
      [`POST /api/exports/${made.id}/save-link`]: saveLink,
    });
    const { win } = stubOpen();
    await renderInRouter(
      <SaveFile
        item={{
          id: ITEM_ID,
          sponsorSegments: [{ start: 49, end: 69, category: "sponsor", show: true, skip: true }],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const sheet = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(sheet).getByRole("button", { name: "Without sponsors" })).toBeInTheDocument();
    });
    await userEvent.click(within(sheet).getByRole("button", { name: "Without sponsors" }));
    await waitFor(() => {
      expect(win?.location.href).toContain(SAVE);
    });
    expect(calls.some((c) => c.path === `/api/exports/${made.id}/save-link`)).toBe(true);
  });

  it("saves from a tile's menu through the entry's save link", async () => {
    const calls = fakeApi({ [`POST /api/library/${ITEM_ID}/save-link`]: saveLink });
    const { win } = stubOpen();
    const nothing = () => undefined;
    await renderInRouter(
      <ul>
        <EntryTile
          entry={itemFixture}
          onRemove={nothing}
          onSaveToPlaylist={nothing}
          onToggleWatched={nothing}
        />
      </ul>,
    );
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${itemFixture.title}` }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => {
      expect(win?.location.href).toContain(SAVE);
    });
    expect(calls.some((c) => c.path === `/api/library/${ITEM_ID}/save-link`)).toBe(true);
  });

  it("saves a finished copy from Downloads through its save link", async () => {
    const made = copy({});
    const calls = fakeApi({
      "GET /api/exports": () => Response.json([made]),
      [`POST /api/exports/${made.id}/save-link`]: saveLink,
    });
    const { win } = stubOpen();
    renderWithQuery(<ExportsSection />);
    await userEvent.click(await screen.findByRole("button", { name: `Save ${made.title}` }));
    await waitFor(() => {
      expect(win?.location.href).toContain(SAVE);
    });
    expect(calls.some((c) => c.path === `/api/exports/${made.id}/save-link`)).toBe(true);
  });
});
