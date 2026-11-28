import type { AdminHealth } from "@uroboros/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter, renderWithQuery } from "@/test/render";

import { AdminHealthPage } from "./AdminHealthPage";
import { elapsed, fullTime } from "./health/format";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const admin = {
  id: id(1),
  displayName: "Root",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: true,
};
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const MIN = 60_000;

const replica = (n: number, over: Partial<AdminHealth["replicas"][number]>) => ({
  id: id(n),
  host: `host-${String(n)}`,
  version: "0.1.5",
  startedAt: ago(120 * MIN),
  seenAt: ago(5000),
  leader: false,
  status: "ok" as const,
  failing: [],
  runningJobs: 0,
  current: false,
  ...over,
});

const retry = later(12 * MIN);
const health: AdminHealth = {
  version: "0.1.5",
  replicas: [
    replica(1, { leader: true, current: true, runningJobs: 3 }),
    replica(2, { status: "degraded", failing: ["storage"], version: "0.1.6" }),
    replica(3, { status: "not_answering", seenAt: ago(3 * MIN) }),
  ],
  cooldowns: [
    {
      site: "youtube.com",
      scope: "site",
      until: retry,
      strikes: 3,
      active: true,
      waitingDownloads: 4,
      waitingLinks: 1,
    },
    {
      site: "vimeo.com",
      scope: "subtitles",
      until: ago(MIN),
      strikes: 1,
      active: false,
      waitingDownloads: 0,
      waitingLinks: 0,
    },
  ],
  events: [
    {
      id: id(10),
      at: ago(MIN),
      site: "youtube.com",
      scope: "site",
      source: "download",
      message: "[youtube] x: Sign in to confirm you're not a bot",
      url: "https://www.youtube.com/watch?v=x",
      title: "Big Buck Bunny",
      entryId: null,
      until: new Date(Date.now() - MIN + 4 * MIN).toISOString(),
      hinted: false,
      strikes: 3,
    },
    {
      id: id(11),
      at: ago(30 * MIN),
      site: "example.com",
      scope: "site",
      source: "search",
      message: "HTTP Error 429: Too Many Requests",
      url: null,
      title: null,
      entryId: null,
      until: new Date(Date.now() - 30 * MIN + 3_600_000).toISOString(),
      hinted: true,
      strikes: 1,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function shown(report: AdminHealth = health) {
  fakeApi({ "GET /api/admin/health": () => Response.json(report) });
  renderWithQuery(<AdminHealthPage me={admin} />);
  await screen.findByRole("table", { name: "Replicas" });
}

const tile = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

describe("AdminHealthPage", () => {
  it("leads with the version, the replicas answering, the leader and the sites limiting", async () => {
    await shown();
    expect(tile("Version")).toBe("0.1.5");
    expect(screen.getByText("Replicas run 0.1.5 and 0.1.6.")).toBeInTheDocument();
    expect(tile("Replicas answering")).toBe("2 of 3");
    expect(tile("Leader")).toBe("host-1");
    expect(tile("Sites limiting")).toBe("1");
  });

  it("lists each replica: its state, version, leader, jobs, and this one marked", async () => {
    await shown();
    const rows = within(screen.getByRole("table", { name: "Replicas" })).getAllByRole("row");
    const [, first, second, third] = rows.map((r) => r.textContent);
    expect(first).toContain("host-1");
    expect(first).toContain("This replica");
    expect(first).toContain("Ready");
    expect(first).toContain("Leader");
    expect(first).toContain("3");
    expect(second).toContain("Degraded: storage");
    expect(second).toContain("0.1.6");
    expect(third).toContain("Not answering");
    expect(third).toContain("3 minutes ago");
  });

  it("lists the sites limiting now, with when they're asked again and what waits", async () => {
    await shown();
    const table = within(screen.getByRole("table", { name: "Rate limits now" }));
    const youtube = table.getByText("youtube.com").closest("tr") as HTMLElement;
    expect(youtube.textContent).toContain("All requests");
    expect(youtube.textContent).toContain("Limiting");
    expect(youtube.textContent).toContain(clock(retry));
    expect(youtube.textContent).toContain("in 12 minutes");
    expect(youtube.textContent).toContain("4 downloads, 1 link");
    const vimeo = table.getByText("vimeo.com").closest("tr") as HTMLElement;
    expect(vimeo.textContent).toContain("Subtitles");
    expect(vimeo.textContent).toContain("Over");
    expect(vimeo.textContent).toContain("Nothing waits");
  });

  it("lists the recent rate limits in a table: when, site, work, video, message, cooldown and retry", async () => {
    await shown();
    const [limited, searched] = health.events;
    if (limited === undefined || searched === undefined) throw new Error("two limits expected");
    const table = within(screen.getByRole("table", { name: "Recent rate limits" }));
    const [, first, second] = table.getAllByRole("row").map((r) => r.textContent);
    expect(table.getByRole("link", { name: "Big Buck Bunny" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=x",
    );
    expect(table.getByText("[youtube] x: Sign in to confirm you're not a bot")).toBeInTheDocument();
    for (const part of [
      /1 min \d+ s ago/,
      clock(limited.at),
      "youtube.com",
      "Download",
      "4 min",
      "estimated · 3 in a row",
      clock(limited.until),
    ]) {
      expect(first).toMatch(part);
    }
    for (const part of [/30 min \d+ s ago/, "Search", "1 h", "as the site said"]) {
      expect(second).toMatch(part);
    }
  });

  it("counts up the time since each rate limit while the page is open", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const event = health.events[0];
    if (event === undefined) throw new Error("a sample limit expected");
    await shown({ ...health, events: [{ ...event, at: ago(5000) }] });
    const table = within(screen.getByRole("table", { name: "Recent rate limits" }));
    expect(table.getByText("5 s ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(table.getByText("8 s ago")).toBeInTheDocument();
  });

  it("shows the real time when hovering a relative one", async () => {
    await shown();
    const [limited] = health.events;
    const [self] = health.replicas;
    const [cooldown] = health.cooldowns;
    if (limited === undefined || self === undefined || cooldown === undefined) {
      throw new Error("samples expected");
    }
    const log = within(screen.getByRole("table", { name: "Recent rate limits" }));
    const replicas = within(screen.getByRole("table", { name: "Replicas" }));
    const now = within(screen.getByRole("table", { name: "Rate limits now" }));
    for (const [time, iso] of [
      [log.getByText(/^1 min \d+ s ago$/), limited.at],
      [replicas.getAllByText("2 hours ago")[0], self.startedAt],
      [replicas.getAllByText("this minute")[0], self.seenAt],
      [now.getByText("in 12 minutes"), cooldown.until],
    ] as const) {
      if (time === undefined) throw new Error("a relative time expected");
      await userEvent.hover(time);
      // jsdom never closes the one before (Radix waits for the pointer to leave its grace area).
      await waitFor(() => {
        const tips = screen.getAllByRole("tooltip").map((t) => t.textContent);
        expect(tips).toContain(fullTime(iso));
      });
    }
  });

  it("swaps a relative time for the real one when clicked, and back", async () => {
    await shown();
    const [limited] = health.events;
    if (limited === undefined) throw new Error("a sample limit expected");
    const log = within(screen.getByRole("table", { name: "Recent rate limits" }));
    const when = log.getByRole("button", { name: /^1 min \d+ s ago$/ });
    await userEvent.click(when);
    expect(when).toHaveTextContent(fullTime(limited.at));
    expect(when).toHaveAttribute("aria-pressed", "true");
    // A click closes the tooltip; hovered again, it now says how long ago.
    await userEvent.unhover(when);
    await userEvent.hover(when);
    await waitFor(() => {
      const tips = screen.getAllByRole("tooltip").map((t) => t.textContent);
      expect(tips).toContainEqual(expect.stringMatching(/^1 min \d+ s ago$/));
    });
    await userEvent.click(when);
    expect(when).toHaveTextContent(/^1 min \d+ s ago$/);
    expect(when).toHaveAttribute("aria-pressed", "false");
  });

  it("opens a held video in the library when the viewer holds it, else on its site", async () => {
    const [limited] = health.events;
    if (limited === undefined) throw new Error("a sample limit expected");
    const held = {
      ...limited,
      id: id(12),
      scope: "subtitles" as const,
      source: "subtitles" as const,
      title: "Held subtitles",
      entryId: id(300),
    };
    fakeApi({
      "GET /api/admin/health": () => Response.json({ ...health, events: [held, limited] }),
    });
    await renderInRouter(<AdminHealthPage me={admin} />);
    const log = within(await screen.findByRole("table", { name: "Recent rate limits" }));
    const inLibrary = log.getByRole("link", { name: "Held subtitles" });
    expect(inLibrary).toHaveAttribute("href", `/library/${id(300)}`);
    expect(inLibrary).not.toHaveAttribute("target");
    expect(log.getByRole("link", { name: "Big Buck Bunny" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=x",
    );
  });

  it("says when no site limits anything, and none did this week", async () => {
    await shown({ ...health, cooldowns: [], events: [] });
    expect(screen.getByText("No site is limiting requests.")).toBeInTheDocument();
    expect(screen.getByText("No site limited requests in the past week.")).toBeInTheDocument();
    expect(tile("Sites limiting")).toBe("0");
  });

  it("keeps what it last read when a refresh fails, and says the refresh failed", async () => {
    let reads = 0;
    fakeApi({
      "GET /api/admin/health": () =>
        ++reads === 1
          ? Response.json(health)
          : Response.json({ code: "unavailable", message: "Starting up." }, { status: 503 }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdminHealthPage me={admin} />
      </QueryClientProvider>,
    );
    await screen.findByRole("table", { name: "Replicas" });
    await act(() => client.refetchQueries({ queryKey: ["api", "admin", "health"] }));
    const line = await screen.findByText(
      (_, el) => el?.tagName === "P" && el.textContent.startsWith("Couldn't refresh"),
    );
    expect(line.textContent).toMatch(
      /^Couldn't refresh: The server is not ready\..* This is what it read at /,
    );
    expect(screen.getByRole("table", { name: "Replicas" })).toBeInTheDocument();
  });

  it("tells a member it's for admins", () => {
    renderWithQuery(<AdminHealthPage me={{ ...admin, role: "member" }} />);
    expect(screen.getByText("Only admins can see the server's health.")).toBeInTheDocument();
  });
});

describe("elapsed", () => {
  it("counts seconds, then minutes and seconds, hours and minutes, days and hours", () => {
    expect(elapsed(0)).toBe("0 s ago");
    expect(elapsed(42_400)).toBe("42 s ago");
    expect(elapsed(252_000)).toBe("4 min 12 s ago");
    expect(elapsed(2 * 3_600_000 + 5 * 60_000 + 9000)).toBe("2 h 5 min ago");
    expect(elapsed(3 * 86_400_000 + 3_600_000)).toBe("3 d 1 h ago");
    // A clock a little ahead of the server's never reads as the future.
    expect(elapsed(-2000)).toBe("0 s ago");
  });
});
