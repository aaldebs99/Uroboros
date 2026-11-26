import { render, screen } from "@testing-library/react";
import { Download } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { SaveButton } from "./SaveButton";
import { savesInWindow } from "./saveInWindow";

/**
 * The installed iPhone app on an http address (a LAN install; jsdom's page is http): iOS has no
 * Safari scheme for http, so Save stays the plain download link there (docs/downloads.md#saving-a-file).
 */

vi.mock("@/push/installed", async (original) => ({
  ...(await original<object>()),
  isIos: () => true,
  isInstalled: () => true,
}));

describe("Save in the installed iPhone app on an http address", () => {
  it("stays the plain download link", () => {
    expect(window.location.protocol).toBe("http:");
    expect(savesInWindow()).toBe(false);
    render(
      <SaveButton href="/f" link={() => Promise.resolve()} aria-label="Save">
        <Download aria-hidden />
      </SaveButton>,
    );
    const link = screen.getByRole("link", { name: "Save" });
    expect(link).toHaveAttribute("href", "/f");
    expect(link).toHaveAttribute("download");
  });
});
