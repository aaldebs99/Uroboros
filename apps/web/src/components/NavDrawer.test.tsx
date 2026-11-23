import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "@/test/render";

import { NavDrawer } from "./NavDrawer";

const dialog = () => screen.queryByRole("dialog", { hidden: true });
const panel = () => dialog()?.querySelector<HTMLElement>(".drawer-panel");

/** A one-finger touch at (x, y), dispatched on `on` (the document unless a start says where). */
function touch(
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y = 300,
  on: Document | Element = document,
) {
  fireEvent[type](on, { changedTouches: [{ identifier: 1, clientX: x, clientY: y }] });
}

function renderDrawer(swipe = true) {
  return renderInRouter(<NavDrawer location="/" isAdmin={false} swipe={swipe} />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
  // jsdom lays nothing out; the drag measures the panel to follow the finger.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
});

describe("NavDrawer", () => {
  it("follows a finger dragged across the page from anywhere and settles open", async () => {
    await renderDrawer();
    touch("touchStart", 120);
    touch("touchMove", 140);
    expect(dialog()).toHaveAttribute("data-phase", "dragging");
    touch("touchMove", 260);
    expect(panel()?.style.translate).toBe("-100px 0");
    act(() => {
      touch("touchEnd", 260);
    });
    expect(dialog()).toHaveAttribute("open");
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
  });

  it("drags the open drawer shut", async () => {
    await renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(dialog()).toHaveAttribute("open");
    touch("touchStart", 200);
    touch("touchMove", 180);
    touch("touchMove", 40);
    act(() => {
      touch("touchEnd", 40);
    });
    await waitFor(() => {
      expect(dialog()).not.toBeInTheDocument();
    });
  });

  it("leaves a vertical scroll alone", async () => {
    await renderDrawer();
    touch("touchStart", 120, 300);
    touch("touchMove", 122, 340);
    touch("touchEnd", 122, 340);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("leaves a sideways drag that starts on the player alone", async () => {
    await renderInRouter(
      <>
        <div data-own-swipe="" data-testid="player" />
        <NavDrawer location="/" isAdmin={false} swipe />
      </>,
    );
    const player = screen.getByTestId("player");
    touch("touchStart", 120, 300, player);
    touch("touchMove", 260, 300, player);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("does not follow a finger when swipe is off", async () => {
    await renderDrawer(false);
    touch("touchStart", 120);
    touch("touchMove", 260);
    touch("touchEnd", 260);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("slides out on Escape and on the scrim, the focus back on the menu button", async () => {
    await renderDrawer();
    const menu = screen.getByRole("button", { name: "Open navigation" });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    act(() => {
      dialog()?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(dialog()).toHaveAttribute("data-phase", "closing");
    await waitFor(() => {
      expect(dialog()).not.toBeInTheDocument();
    });
    expect(menu).toHaveFocus();

    await userEvent.click(menu);
    const scrim = dialog()?.querySelector(".drawer-scrim");
    if (!scrim) throw new Error("no scrim");
    await userEvent.click(scrim);
    await waitFor(() => {
      expect(dialog()).not.toBeInTheDocument();
    });
  });
});
