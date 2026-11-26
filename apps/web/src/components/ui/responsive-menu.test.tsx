import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Eye, ExternalLink, Pin } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { type MenuAction, ResponsiveMenu } from "./responsive-menu";

/** A ⋮ menu with two toggle rows (one on), a hairline, and a page to open in a new tab. */
const actions: MenuAction[] = [
  { label: "Watched", icon: Eye, checked: false, onSelect: () => undefined },
  { label: "Pinned", icon: Pin, checked: true, onSelect: () => undefined },
  {
    label: "Open the page",
    icon: ExternalLink,
    href: "https://example.com/v",
    external: true,
    separated: true,
  },
];

function renderMenu() {
  render(
    <ResponsiveMenu
      title="More actions"
      actions={actions}
      trigger={<Button aria-label="More actions">⋮</Button>}
    />,
  );
  return userEvent.click(screen.getByRole("button", { name: "More actions" }));
}

describe("ResponsiveMenu on a phone (a bottom sheet)", () => {
  it("says which toggle rows are on", async () => {
    await renderMenu();
    expect(screen.getByRole("button", { name: "Pinned" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Watched" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("opens an external page in a new tab rather than saving it", async () => {
    await renderMenu();
    const link = screen.getByRole("link", { name: "Open the page" });
    expect(link).toHaveAttribute("href", "https://example.com/v");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).not.toHaveAttribute("download");
  });
});

describe("ResponsiveMenu from md up (a dropdown)", () => {
  it("makes toggle rows checkbox items, and puts a hairline before a separated row", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await renderMenu();
    expect(await screen.findByRole("menuitemcheckbox", { name: "Pinned" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemcheckbox", { name: "Watched" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const link = screen.getByRole("menuitem", { name: "Open the page" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.previousElementSibling).toHaveAttribute("role", "separator");
  });
});
