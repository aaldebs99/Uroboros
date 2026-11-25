import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { stubApi } from "../test/render";

/** Renders the app at `path`, once the shell is up: its side navigation, or `ready`. */
/** A window from `md` (48rem) up: the top bar's Add pill and the side navigation. */
function stubWide() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === "(min-width: 48rem)",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

async function renderAt(
  path: string,
  ready = () => screen.findByRole("navigation", { name: "Primary" }),
) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await ready();
  return router;
}

beforeEach(() => {
  stubApi({
    "/api/info": () => Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
    "/api/me": () =>
      Response.json({
        id: "0190a3f2-7c1e-7000-8000-000000000001",
        displayName: "Alice",
        email: null,
        role: "member",
        method: "local",
        isBootstrap: false,
      }),
    "/api/me/push": () =>
      Response.json({ enabled: false, publicKey: null, devices: [], maxDevices: 10 }),
    "/api/subscriptions": () => Response.json([]),
    "/api/notices": () => Response.json({ notices: [], unread: 0 }),
    "/api/downloads?active=true": () => Response.json([]),
    "/api/uploads": () => Response.json([]),
    "/api/exports": () => Response.json([]),
  });
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("app shell", () => {
  it("renders the nav links, with the library's, Shared's and Settings' views indented under them", async () => {
    await renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "Library",
      "Videos",
      "Channels",
      "Playlists",
      "Downloads",
      "Subscriptions",
      "Shared",
      "With me",
      "By me",
      "Settings",
      "Notifications",
      "Logins",
      "Profiles",
      "Groups",
      "Tokens",
    ]);
  });

  it("marks the current library view, and hides the views on the mini rail", async () => {
    await renderAt("/library/channels");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const views = within(nav).getByRole("list", { name: "Library views" });
    expect(within(views).getByRole("link", { name: "Channels" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(views).getByRole("link", { name: "Videos" })).not.toHaveAttribute("aria-current");

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(within(nav).queryByRole("list", { name: "Library views" })).not.toBeInTheDocument();
  });

  it("navigating to /subscriptions shows the subscriptions", async () => {
    await renderAt("/settings");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await userEvent.click(within(nav).getByRole("link", { name: "Subscriptions" }));

    expect(await screen.findByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(await screen.findByText("No subscriptions yet")).toBeInTheDocument();
  });

  it("puts the brand and the account menu in the top bar, and the nav below it", async () => {
    await renderAt("/");

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Uroboros")).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Account menu for Alice" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(header).not.toContainElement(nav);
    expect(within(nav).queryByText("Uroboros")).not.toBeInTheDocument();
  });

  it("puts the bell between Add and the account menu on wide screens", async () => {
    stubWide();
    await renderAt("/");

    const header = screen.getByRole("banner");
    const buttons = within(header)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(buttons.slice(-3)).toEqual(["Add", "Notifications", "Account menu for Alice"]);
  });

  it("leaves Add to the tab bar on phones: the top bar has none", async () => {
    await renderAt("/");

    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    const buttons = within(header)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(buttons.slice(-3)).toEqual(["Open search", "Notifications", "Account menu for Alice"]);
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("takes the brand in the top bar to the library, dropping a search", async () => {
    const router = await renderAt("/downloads");
    const header = screen.getByRole("banner");
    await userEvent.click(
      within(header).getByRole("link", { name: "Uroboros, go to the library" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });

    await router.navigate({ href: "/?q=bunny" });
    await userEvent.click(
      within(header).getByRole("link", { name: "Uroboros, go to the library" }),
    );
    await waitFor(() => {
      expect(router.state.location.searchStr).toBe("");
    });
  });

  it("shows the Notifications section in Settings", async () => {
    await renderAt("/settings");

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(await screen.findByText(/notifications are off on this server/i)).toBeInTheDocument();
  });

  it("picks a theme in the account menu's Appearance and remembers it", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Appearance/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

    expect(localStorage.getItem("uroboros-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("puts the bottom tabs on phones: Library, Downloads, Add, Subscriptions, You", async () => {
    await renderAt("/");

    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Library", "Downloads", "Subscriptions", "You"]);
    expect(within(tabs).getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("adds a video from the phone's + sheet: Download a link, or Upload a video", async () => {
    await renderAt("/");

    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    await userEvent.click(within(tabs).getByRole("button", { name: "Add" }));
    const sheet = await screen.findByRole("dialog", { name: "Add" });
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Download", "Upload"]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("dialog", { name: "Upload a video" })).toBeInTheDocument();
    expect(screen.getByLabelText("Creator")).toHaveValue("Alice");
  });

  it("adds from the top bar's menu on wide screens", async () => {
    stubWide();
    await renderAt("/");

    const header = screen.getByRole("banner");
    await userEvent.click(within(header).getByRole("button", { name: "Add" }));
    const menu = await screen.findByRole("menu", { name: "Add" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Download", "Upload"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Download" }));
    expect(await screen.findByRole("dialog", { name: "Download a link" })).toBeInTheDocument();
  });

  it("collapses the side navigation to the mini rail and remembers it", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));

    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    expect(localStorage.getItem("uroboros-nav-mini")).toBe("1");
  });

  it("puts the navigation in a drawer on a watch page, which any navigation closes", async () => {
    const router = await renderAt("/library/0190a3f2-7c1e-7000-8000-000000000200", () =>
      screen.findByRole("button", { name: "Open navigation" }),
    );
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    await userEvent.click(within(drawer).getByRole("link", { name: "Downloads" }));

    // Downloads has the side navigation again, and no drawer.
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Back on the watch page, the drawer stays closed until asked for.
    router.history.back();
    await screen.findByRole("button", { name: "Open navigation" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["a watch page", "/library/0190a3f2-7c1e-7000-8000-000000000200"],
    ["a channel page", "/library/channels/Blender"],
    ["a playlist page", "/library/playlists/0190a3f2-7c1e-7000-8000-000000000300"],
    ["a subscription's page", "/subscriptions/0190a3f2-7c1e-7000-8000-000000000400"],
  ])("leaving %s asks for nothing under the next page's name", async (_, path) => {
    const router = await renderAt(path, () =>
      screen.findByRole("button", { name: "Account menu for Alice" }),
    );
    await router.navigate({ to: "/downloads" });
    await screen.findByRole("navigation", { name: "Primary" });

    const asked = vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
    // Only the downloads page's own requests may name it.
    expect(
      asked.filter((url) => url.includes("downloads") && !url.startsWith("/api/downloads")),
    ).toEqual([]);
  });

  it("opens the navigation as a drawer from the phone top bar's menu button", async () => {
    await renderAt("/");

    // From md up the same bar has the mini-rail toggle; the drawer's button is for phones.
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    await userEvent.click(within(drawer).getByRole("link", { name: "Downloads" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the watch page's drawer with its own menu button, sliding it out first", async () => {
    await renderAt("/library/0190a3f2-7c1e-7000-8000-000000000200", () =>
      screen.findByRole("button", { name: "Open navigation" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Close navigation" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("shows the Admin section only to admins", async () => {
    await renderAt("/");
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("opens the search palette from the phone's search button", async () => {
    await renderAt("/settings");
    await userEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(await screen.findByRole("dialog", { name: "Search or download" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Search your library or paste a link" }),
    ).toHaveFocus();
  });
});
