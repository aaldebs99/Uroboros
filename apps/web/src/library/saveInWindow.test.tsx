// The page is served over https here, as a real deployment is: Safari takes over only from one.
// @vitest-environment-options {"url": "https://uro.example/"}
import type { Export } from "@uroboros/contract";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Download } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify, Toaster } from "@/components/ui/sonner";
import { ExportsSection } from "@/exports/ExportsSection";
import type * as InstalledModule from "@/push/installed";
import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID, itemFixture } from "@/test/libraryItem";
import { renderInRouter, renderWithQuery } from "@/test/render";

import { SaveButton } from "./SaveButton";
import { SaveFile } from "./SaveFile";
import { navigation, openOutside, openSave } from "./saveInWindow";
import { EntryTile } from "./VideoTile";

/**
 * Saving from the installed iPhone app (docs/downloads.md#saving-a-file): following a link to the
 * file would hand the app's only page to iOS's file view with no way back, and a window the app
 * opens is an in-app Safari sheet that can't download (a blank page). So Save hands Safari itself
 * a save link (`x-safari-https:`), which needs no cookie; the app chooses its token, so the link is
 * known inside the tap, and registers it alongside. Everywhere else Save stays a link.
 */

type Installed = typeof InstalledModule;
const where = vi.hoisted(() => ({ iosApp: false }));
vi.mock("@/push/installed", async (original) => ({
  ...(await original<Installed>()),
  isIos: () => where.iosApp,
  isInstalled: () => where.iosApp,
}));

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** What Safari is handed for a token. */
const savesAt = (token: string) => `x-safari-${window.location.origin}/api/public/saves/${token}`;

/** Catches the hand-off (jsdom navigates nowhere) and any window opened instead. */
function stubOpen() {
  vi.stubGlobal(
    "open",
    vi.fn(() => null),
  );
  return vi.spyOn(navigation, "go").mockImplementation(() => undefined);
}
const go = () => vi.spyOn(navigation, "go").mockImplementation(() => undefined);
const tokenIn = (url: unknown) => String(url).split("/").pop() ?? "";

beforeEach(() => {
  where.iosApp = true;
  // A hand-off leaves a 1.5 s timer (openOutside's check that Safari took over), which on real
  // timers outlives the test and, once this file's page is gone, throws. Fake ones that keep up with
  // the clock let clicks and waits run as usual, and are dropped after each test.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openSave", () => {
  it("hands over a link with a token it chose inside the tap, registering it alongside", () => {
    const open = stubOpen();
    const register = vi.fn(() => new Promise<never>(() => undefined));
    openSave(register);
    expect(register).toHaveBeenCalledOnce();
    const [token] = register.mock.calls[0] as unknown as [string];
    expect(token).toMatch(TOKEN);
    // Before the registration answers: the hand-off can't wait for it.
    expect(open).toHaveBeenCalledWith(savesAt(token));
  });

  it("chooses a new token every time", () => {
    stubOpen();
    const register = vi.fn(() => Promise.resolve());
    openSave(register);
    openSave(register);
    const [[a], [b]] = register.mock.calls as unknown as [[string], [string]];
    expect(a).not.toBe(b);
  });

  it("says why when the link can't be registered", async () => {
    render(<Toaster />);
    stubOpen();
    openSave(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await screen.findByText("Could not reach the server.")).toBeInTheDocument();
  });
});

describe("openOutside", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const said = () => vi.spyOn(notify, "error").mockImplementation(() => undefined);

  it("hands an https link to Safari itself, where downloads work", () => {
    const to = go();
    openOutside("https://uro.example/api/public/saves/abc");
    expect(to).toHaveBeenCalledWith("x-safari-https://uro.example/api/public/saves/abc");
  });

  it("says so when Safari never takes over (iOS before 17)", () => {
    go();
    const error = said();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    openOutside("https://uro.example/api/public/saves/abc");
    vi.advanceTimersByTime(1499);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(error).toHaveBeenCalledWith("Couldn't open Safari to save the file", expect.anything());
  });

  it("says nothing once Safari has taken over", () => {
    go();
    const error = said();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    openOutside("https://uro.example/api/public/saves/abc");
    vi.advanceTimersByTime(5000);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("SaveButton", () => {
  it("is a plain download link outside the installed iPhone app", () => {
    where.iosApp = false;
    render(
      <SaveButton href="/f" link={() => Promise.resolve()} aria-label="Save">
        <Download aria-hidden />
      </SaveButton>,
    );
    const link = screen.getByRole("link", { name: "Save" });
    expect(link).toHaveAttribute("href", "/f");
    expect(link).toHaveAttribute("download");
  });

  it("hands a save link over in the installed iPhone app", async () => {
    const open = stubOpen();
    const register = vi.fn(() => Promise.resolve());
    render(
      <SaveButton href="/f" link={register} aria-label="Save">
        <Download aria-hidden />
      </SaveButton>,
    );
    expect(screen.queryByRole("link", { name: "Save" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const [token] = register.mock.calls[0] as unknown as [string];
    expect(open).toHaveBeenCalledWith(savesAt(token));
  });

  it("hands over a URL that needs no session (a public link's) as it is", async () => {
    const open = stubOpen();
    render(
      <SaveButton href="/api/public/s/abc/items/x/file" aria-label="Download">
        <Download aria-hidden />
      </SaveButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(open).toHaveBeenCalledWith(
      `x-safari-${window.location.origin}/api/public/s/abc/items/x/file`,
    );
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
    clip: null,
    ...over,
  });
  const registered = () =>
    Response.json(
      { url: "/api/public/saves/x", expiresAt: "2026-11-26T20:00:00.000Z" },
      { status: 201 },
    );
  /** The registration's token is the one the opened link carries. */
  async function handedOver(
    calls: { path: string; body: unknown }[],
    path: string,
    open: ReturnType<typeof stubOpen>,
  ) {
    await waitFor(() => {
      expect(calls.some((c) => c.path === path)).toBe(true);
    });
    const body = calls.find((c) => c.path === path)?.body as { token: string };
    expect(body.token).toMatch(TOKEN);
    expect(tokenIn(open.mock.calls[0]?.[0])).toBe(body.token);
  }

  it("saves the watch page's file through an entry's save link", async () => {
    const path = `/api/library/${ITEM_ID}/save-link`;
    const calls = fakeApi({ [`POST ${path}`]: registered });
    const open = stubOpen();
    await renderInRouter(<SaveFile item={{ id: ITEM_ID, sponsorSegments: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await handedOver(calls, path, open);
  });

  it("saves a copy without sponsors through the copy's save link", async () => {
    const made = copy({});
    const path = `/api/exports/${made.id}/save-link`;
    const calls = fakeApi({
      "GET /api/exports": () => Response.json([made]),
      [`POST ${path}`]: registered,
    });
    const open = stubOpen();
    await renderInRouter(
      <SaveFile
        item={{
          id: ITEM_ID,
          sponsorSegments: [{ start: 49, end: 69, category: "sponsor", show: true, skip: true }],
        }}
      />,
    );
    await waitFor(() => {
      // Once the copy is known, its row saves it rather than asking for a new one.
      expect(calls.some((c) => c.path === "/api/exports")).toBe(true);
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(await within(sheet).findByRole("button", { name: "Without sponsors" }));
    await handedOver(calls, path, open);
  });

  it("saves from a tile's menu through the entry's save link", async () => {
    const path = `/api/library/${ITEM_ID}/save-link`;
    const calls = fakeApi({ [`POST ${path}`]: registered });
    const open = stubOpen();
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
    await handedOver(calls, path, open);
  });

  it("saves a finished copy from Downloads through its save link", async () => {
    const made = copy({});
    const path = `/api/exports/${made.id}/save-link`;
    const calls = fakeApi({
      "GET /api/exports": () => Response.json([made]),
      [`POST ${path}`]: registered,
    });
    const open = stubOpen();
    renderWithQuery(<ExportsSection />);
    await userEvent.click(await screen.findByRole("button", { name: `Save ${made.title}` }));
    await handedOver(calls, path, open);
  });
});
