import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DESKTOP_QUERY } from "@/lib/media";

import { notify, Toaster } from "./sonner";

/** A window `md` and up (`desktop`) or narrower, as `useMediaQuery` reads it. */
function windowIs(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query === DESKTOP_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

async function toaster(element: React.ReactElement) {
  render(element);
  act(() => {
    notify.success("Saved");
  });
  await screen.findByText("Saved");
  const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
  if (list === null) throw new Error("no toaster");
  return list;
}

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    toast.dismiss();
  });
});

describe("toasts", () => {
  it("come in at the top right from md up, under the top bar", async () => {
    windowIs(true);
    const list = await toaster(<Toaster aboveTabBar />);
    expect(list).toHaveAttribute("data-y-position", "top");
    expect(list).toHaveAttribute("data-x-position", "right");
    expect(list.style.getPropertyValue("--offset-top")).toBe("4.5rem");
  });

  it("come in at the bottom right on phones, just above the bottom tabs", async () => {
    windowIs(false);
    const list = await toaster(<Toaster aboveTabBar />);
    expect(list).toHaveAttribute("data-y-position", "bottom");
    expect(list).toHaveAttribute("data-x-position", "right");
    const above = "calc(3.625rem + env(safe-area-inset-bottom) + 0.75rem)";
    expect(list.style.getPropertyValue("--offset-bottom")).toBe(above);
    expect(list.style.getPropertyValue("--mobile-offset-bottom")).toBe(above);
    expect(list.style.getPropertyValue("--mobile-offset-right")).toBe("1rem");
  });

  it("keep to the bottom edge on a phone page without the tabs (a public link)", async () => {
    windowIs(false);
    const list = await toaster(<Toaster />);
    expect(list).toHaveAttribute("data-y-position", "bottom");
    expect(list.style.getPropertyValue("--mobile-offset-bottom")).toBe("1rem");
  });
});
