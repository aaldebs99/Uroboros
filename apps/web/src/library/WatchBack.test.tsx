import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID as ID } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";
import { WatchBack } from "./WatchBack";
import { keepTrail } from "./watchOrigin";

const VIDEO = "/library/0190a3f2-7c1e-7000-8000-000000000200";
const NEXT = "/library/0190a3f2-7c1e-7000-8000-000000000201";

/** A router with a watch page, a page that says which it is, and the history's trail kept. */
async function renderAt(...entries: string[]) {
  const root = createRootRoute({ component: Outlet });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>page {path}</p> });
  const watch = createRoute({
    getParentRoute: () => root,
    path: "/library/$entryId",
    component: WatchBack,
  });
  const history = keepTrail(createMemoryHistory({ initialEntries: [entries[0] ?? "/"] }));
  const router = createRouter({
    routeTree: root.addChildren([page("/"), page("/downloads"), watch]),
    history,
  });
  for (const path of entries.slice(1)) history.push(path);
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("WatchBack", () => {
  it("goes back to the page the video was opened from, past the videos played since", async () => {
    const router = await renderAt("/downloads", VIDEO, NEXT);
    const back = await screen.findByRole("link", { name: "Downloads" });
    expect(back.getAttribute("href")).toBe("/downloads");
    await userEvent.click(back);
    await screen.findByText("page /downloads");
    // Back through the history, not a new entry on it.
    expect(router.history.location.state.__TSR_index).toBe(0);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/downloads");
    });
  });

  it("leads to the Library from a watch page opened from outside", async () => {
    const router = await renderAt(VIDEO);
    const back = await screen.findByRole("link", { name: "Library" });
    expect(back.getAttribute("href")).toBe("/");
    await userEvent.click(back);
    await screen.findByText("page /");
    expect(router.history.location.state.__TSR_index).toBe(1);
  });
});

describe("a watch page's back link", () => {
  it("is there while the video loads, and when it isn't there", async () => {
    let answer: (response: Response) => void = () => undefined;
    fakeApi({
      [`GET /api/library/${ID}`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const { container } = await renderInRouter(<ItemPage entryId={ID} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/");
    answer(Response.json({ code: "not_found", message: "gone" }, { status: 404 }));
    await screen.findByText("This video isn't available");
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/");
  });
});
