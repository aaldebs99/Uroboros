import type { AdminStats } from "@uroboros/contract";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { AdminStatsPage } from "./AdminStatsPage";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const admin = {
  id: id(1),
  displayName: "Root",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: true,
};
const GB = 1024 ** 3;
const stats: AdminStats = {
  files: { total: 1284, videos: 1200, audio: 84, bytes: 6 * GB },
  containers: [
    { container: "mp4", files: 1000, bytes: 5 * GB },
    { container: "m4a", files: 84, bytes: GB },
  ],
  storage: {
    total: 8 * GB,
    parts: [
      { kind: "files", bytes: 6 * GB },
      { kind: "thumbnails", bytes: 0 },
      { kind: "info", bytes: 0 },
      { kind: "previews", bytes: 2 * GB },
      { kind: "subtitles", bytes: 0 },
      { kind: "exports", bytes: 0 },
      { kind: "uploads", bytes: 0 },
      { kind: "playback", bytes: 0 },
    ],
    unmeasured: 12,
  },
  people: [
    {
      userId: id(2),
      displayName: "Alice",
      username: "alice",
      items: 900,
      videos: 850,
      audio: 50,
      bytes: 6 * GB,
    },
    {
      userId: id(1),
      displayName: "Root",
      username: "root",
      items: 0,
      videos: 0,
      audio: 0,
      bytes: 0,
    },
  ],
  unclaimed: { files: 3, bytes: 2 * GB },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminStatsPage", () => {
  it("shows the headline numbers, storage by kind and container, and each person's", async () => {
    fakeApi({ "GET /api/admin/stats": () => Response.json(stats) });
    renderWithQuery(<AdminStatsPage me={admin} />);
    const tile = async (label: string) =>
      (await screen.findByText(label, { selector: "dt" })).nextElementSibling?.textContent;
    expect(await tile("Media files")).toBe((1284).toLocaleString());
    expect(await tile("Videos")).toBe((1200).toLocaleString());
    expect(await tile("Audio")).toBe("84");
    expect(await tile("Storage used")).toBe("8.0 GB");

    const kinds = within(screen.getByRole("list", { name: "Storage by kind" }));
    const rows = kinds.getAllByRole("listitem").map((li) => li.textContent);
    // Largest first, each with its share of the whole.
    expect(rows[0]).toBe("Media files6.0 GB · 75%");
    expect(rows[1]).toBe("Hover previews2.0 GB · 25%");
    expect(rows).toContain("Playback cache0 B · 0%");
    expect(screen.getByText(/Still measuring 12 files/)).toBeInTheDocument();

    const containers = within(screen.getByRole("list", { name: "Media files by container" }));
    expect(containers.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "mp41,000 files · 5.0 GB",
      "m4a84 files · 1.0 GB",
    ]);

    const alice = screen.getByText("Alice").closest("tr") as HTMLElement;
    expect(within(alice).getByText("900")).toBeInTheDocument();
    expect(alice.textContent).toContain("6.0 GB · 75%");
    expect(screen.getByText(/counts for whoever had it first/)).toBeInTheDocument();
    expect(screen.getByText(/In no one's library: 3 files, 2.0 GB/)).toBeInTheDocument();
  });

  it("tells a member it's for admins", () => {
    renderWithQuery(<AdminStatsPage me={{ ...admin, role: "member" }} />);
    expect(screen.getByText("Only admins can see stats.")).toBeInTheDocument();
  });
});
