import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { NotificationKinds } from "./NotificationKinds";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationKinds", () => {
  it("shows both kinds, and turning one off saves the pair", async () => {
    const calls = fakeApi({
      "GET /api/me/notifications": () => Response.json({ downloads: true, shares: true }),
      "PUT /api/me/notifications": () => Response.json({ downloads: false, shares: true }),
    });
    renderWithQuery(<NotificationKinds />);
    const downloads = await screen.findByRole("switch", { name: "Downloads" });
    expect(downloads).toBeChecked();
    expect(screen.getByRole("switch", { name: "Shared with me" })).toBeChecked();
    await userEvent.click(downloads);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        downloads: false,
        shares: true,
      });
    });
  });
});
