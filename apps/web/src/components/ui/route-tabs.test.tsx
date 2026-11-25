import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "@/test/render";

import { RouteTabs, type RouteTab } from "./route-tabs";

/** The current route is "/", so the last tab is the current one. */
const TABS: readonly RouteTab[] = [
  { to: "/settings", label: "Notifications" },
  { to: "/settings/logins", label: "Logins" },
  { to: "/settings/profiles", label: "Profiles" },
  { to: "/", label: "Here" },
];

const rect = (left: number, right: number) =>
  ({ left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0 }) as DOMRect;

/** Lays the row out from 0 to 300, with the current tab 50 wide from `currentLeft`. */
function layOut(currentLeft: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.tagName === "NAV") return rect(0, 300);
    if (this.getAttribute("aria-current") === "page") return rect(currentLeft, currentLeft + 50);
    return rect(0, 0);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteTabs", () => {
  it("scrolls the row so a current tab past its edge comes into view", async () => {
    layOut(350);
    await renderInRouter(<RouteTabs label="Views" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Here" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Views" }).scrollLeft).toBe(100);
  });

  it("leaves the row alone when the current tab already shows", async () => {
    layOut(200);
    await renderInRouter(<RouteTabs label="Views" tabs={TABS} />);
    expect(screen.getByRole("navigation", { name: "Views" }).scrollLeft).toBe(0);
  });
});
