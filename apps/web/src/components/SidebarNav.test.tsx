import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { SidebarNav } from "./SidebarNav";

describe("SidebarNav", () => {
  // The navigation is a flex column that scrolls. Flex items shrink by default, so on a screen too
  // short for it (an Android app window) its rows squeezed down to their text, 22 pixels instead of
  // 40, and ran into each other, rather than the list scrolling.
  it("never squeezes its rows to fit, so a short screen scrolls it instead", async () => {
    fakeApi({ "GET /api/info": () => Response.json({ name: "Uroboros", version: "0.0.0" }) });
    await renderInRouter(<SidebarNav isAdmin />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveClass("*:shrink-0");
  });

  it("lists the admin pages for an admin, Health last", async () => {
    fakeApi({ "GET /api/info": () => Response.json({ name: "Uroboros", version: "0.0.0" }) });
    await renderInRouter(<SidebarNav isAdmin />);
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    const health = nav.getByRole("link", { name: "Health" });
    expect(health).toHaveAttribute("href", "/admin/health");
    const admin = nav
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith("/admin/"));
    expect(admin).toEqual(["/admin/users", "/admin/groups", "/admin/stats", "/admin/health"]);
  });
});
