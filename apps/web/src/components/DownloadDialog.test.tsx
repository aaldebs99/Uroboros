import type { DownloadRequest, FormatProfile } from "@uroboros/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { createAppRouter } from "../router";
import { fakeApi, type Handler } from "../test/fakeApi";

const BEST = "0190a3f2-7c1e-7000-8000-0000000000a1";
const AUDIO = "0190a3f2-7c1e-7000-8000-0000000000a2";
const REQUEST = "0190a3f2-7c1e-7000-8000-0000000000b1";
const URL_TO_PASTE = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

function profile(id: string, name: string, isDefault: boolean): FormatProfile {
  return {
    id,
    name,
    format: "bv*+ba/b",
    mergeFormat: null,
    audioOnly: false,
    audioFormat: null,
    extraArgs: [],
    sponsorblockRemove: [],
    builtIn: true,
    isDefault,
    revision: "1",
  };
}

function request(overrides: Partial<DownloadRequest>): DownloadRequest {
  return {
    id: REQUEST,
    url: URL_TO_PASTE,
    profileId: BEST,
    state: "probing",
    kind: null,
    title: null,
    groups: [],
    errorKind: null,
    errorMessage: null,
    stderrTail: [],
    selected: null,
    createdAt: "2026-11-23T04:00:00.000Z",
    ...overrides,
  };
}

function setup(routes: Record<string, Handler> = {}) {
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
    "GET /api/format-profiles": () =>
      Response.json([
        profile(BEST, "Best up to 1080p (MP4)", true),
        profile(AUDIO, "Audio only (Opus)", false),
      ]),
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

async function openLine() {
  const [add] = await screen.findAllByRole("button", { name: "Add" });
  if (add === undefined) throw new Error("no Add button");
  // Add opens its menu (a bottom sheet in jsdom, which has no desktop width): Download, Upload.
  await userEvent.click(add);
  await userEvent.click(await screen.findByRole("button", { name: "Download" }));
  return screen.findByRole("textbox", { name: "Link" });
}

const posts = (calls: ReturnType<typeof fakeApi>) =>
  calls.filter((call) => call.method === "POST" && call.path === "/api/downloads");

afterEach(() => {
  localStorage.clear();
});

describe("DownloadDialog", () => {
  it("opens a focused paste line with the profiles, default first", async () => {
    setup();
    const input = await openLine();

    expect(input).toHaveFocus();
    const picker = screen.getByRole("combobox", { name: "Format" });
    await waitFor(() => {
      expect(
        Array.from((picker as HTMLSelectElement).options).map((option) => option.textContent),
      ).toEqual(["Default (Best up to 1080p (MP4))", "Audio only (Opus)"]);
    });
  });

  it("queues with the chosen profile, closes, and toasts with a link to the request", async () => {
    const { calls, router } = setup({
      "POST /api/downloads": () =>
        Response.json(request({ state: "queued", title: "Big Buck Bunny" }), { status: 202 }),
    });
    const input = await openLine();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Audio only (Opus)" })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Format" }), AUDIO);
    await userEvent.type(input, `  ${URL_TO_PASTE}  {Enter}`);

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Big Buck Bunny")).toBeInTheDocument();
    expect(posts(calls).map((call) => call.body)).toEqual([
      { url: URL_TO_PASTE, profileId: AUDIO },
    ]);
    expect(screen.queryByRole("textbox", { name: "Link" })).not.toBeInTheDocument();

    // A plain click: sonner's pointerdown handler calls setPointerCapture, which jsdom lacks.
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(router.state.location.href).toBe(`/downloads?request=${REQUEST}`);
    });
  });

  it("leaves the profile to the server when the default is picked", async () => {
    const { calls } = setup({
      "POST /api/downloads": () => Response.json(request({}), { status: 202 }),
    });
    await userEvent.type(await openLine(), URL_TO_PASTE);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByText("Added, checking the link")).toBeInTheDocument();
    expect(posts(calls).map((call) => call.body)).toEqual([{ url: URL_TO_PASTE }]);
  });

  it("opens a playlist's preview on the Downloads page", async () => {
    const { router } = setup({
      "POST /api/downloads": () =>
        Response.json(request({ state: "choosing", kind: "playlist" }), { status: 202 }),
    });
    await userEvent.type(await openLine(), `${URL_TO_PASTE}{Enter}`);

    await waitFor(() => {
      expect(router.state.location.href).toBe(`/downloads?request=${REQUEST}`);
    });
  });

  it("refuses anything but an http(s) link without calling the server", async () => {
    const { calls } = setup();
    await userEvent.type(await openLine(), "file:///etc/passwd{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Paste an http or https link.");
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveAttribute("aria-invalid", "true");
    expect(posts(calls)).toEqual([]);
  });

  it("keeps the line open and says why when the server refuses", async () => {
    setup({
      "POST /api/downloads": () =>
        Response.json(
          { code: "bad_request", message: "That URL is not allowed." },
          { status: 400 },
        ),
    });
    await userEvent.type(await openLine(), `${URL_TO_PASTE}{Enter}`);

    expect(await screen.findByRole("alert")).toHaveTextContent("That URL is not allowed.");
    expect(screen.getByRole("textbox", { name: "Link" })).toBeInTheDocument();
  });

  it("shows a request that failed outright", async () => {
    setup({
      "POST /api/downloads": () =>
        Response.json(
          request({ state: "failed", errorKind: "private", errorMessage: "This video is private" }),
          { status: 202 },
        ),
    });
    await userEvent.type(await openLine(), `${URL_TO_PASTE}{Enter}`);

    expect(await screen.findByRole("alert")).toHaveTextContent("This video is private");
  });

  it("names a login wall and keeps yt-dlp's own words in a collapsed disclosure", async () => {
    const line = "ERROR: [vimeo] 753580183: The web client only works when logged-in.";
    setup({
      "POST /api/downloads": () =>
        Response.json(
          request({
            state: "failed",
            errorKind: "login_required",
            errorMessage: "the site needs a signed-in account",
            stderrTail: [line],
          }),
          { status: 202 },
        ),
    });
    await userEvent.type(await openLine(), `${URL_TO_PASTE}{Enter}`);

    expect(await screen.findByRole("alert")).toHaveTextContent("wants a signed-in account");
    expect(screen.getByText(line)).not.toBeVisible();
    await userEvent.click(screen.getByText("yt-dlp output"));
    expect(screen.getByText(line)).toBeVisible();
  });
});
