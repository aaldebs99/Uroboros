import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

/**
 * Motion on phones is quick: the bottom sheet slides up in 200 ms and away in 150, dialogs come
 * and go in 100, and in `index.css` the navigation drawer slides in 150 and toasts move in 200.
 */

const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
/** The body of the stylesheet's phone-only motion block. */
const phoneBlock = () =>
  /Phones: quicker motion[\s\S]*?@media \(width < 48rem\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

describe("motion on phones", () => {
  it("slides the bottom sheet up in 200 ms and away in 150, its scrim with it", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Menu</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    for (const el of [
      screen.getByRole("dialog"),
      document.querySelector("[data-slot=sheet-overlay]"),
    ]) {
      expect(el).toHaveClass("data-[state=open]:duration-200", "data-[state=closed]:duration-150");
    }
  });

  it("brings dialogs and their scrim in and out in 100 ms below md", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Rename</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("max-md:duration-100");
    expect(document.querySelector("[data-slot=dialog-overlay]")).toHaveClass("max-md:duration-100");
  });

  it("slides the navigation drawer in 150 ms and moves toasts in 200", () => {
    const block = phoneBlock();
    expect(block).toMatch(/\.drawer-scrim,\s*\.drawer-panel\s*\{\s*transition-duration: 150ms;/);
    expect(block).toMatch(/\[data-sonner-toast\][^{]*\{\s*transition-duration: 200ms;/);
  });
});
