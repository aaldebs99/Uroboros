import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";
import { itemFixture, SUB_ID, subscriptionFixture } from "@/test/subscriptions";

import { SubscriptionPage } from "./SubscriptionPage";
import { SubscriptionsPage } from "./SubscriptionsPage";

describe("SubscriptionsPage", () => {
  it("shows the empty state with Add subscription", async () => {
    fakeApi({ "GET /api/subscriptions": () => Response.json([]) });
    await renderInRouter(<SubscriptionsPage />);
    expect(await screen.findByText("No subscriptions yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add subscription/ }).length).toBeGreaterThan(0);
  });

  it("lists subscriptions with their status and schedule", async () => {
    fakeApi({
      "GET /api/subscriptions": () =>
        Response.json([
          subscriptionFixture(),
          subscriptionFixture({
            id: "0190a3f2-7c1e-7000-8000-0000000000c2",
            title: "Paused one",
            enabled: false,
            nextCheckAt: null,
          }),
          subscriptionFixture({
            id: "0190a3f2-7c1e-7000-8000-0000000000c3",
            title: "Broken one",
            failures: 2,
            error: { kind: "unavailable", message: "This channel does not exist." },
          }),
        ]),
    });
    await renderInRouter(<SubscriptionsPage />);
    const row = (await screen.findByText("Blender")).closest("li") as HTMLElement;
    expect(within(row).getByText(/every 6 hours/)).toBeInTheDocument();
    expect(within(row).getByText(/Channel · Videos/)).toBeInTheDocument();
    const paused = screen.getByText("Paused one").closest("li") as HTMLElement;
    expect(within(paused).getByText("Paused")).toBeInTheDocument();
    const broken = screen.getByText("Broken one").closest("li") as HTMLElement;
    expect(within(broken).getByText("Failing")).toBeInTheDocument();
  });

  it("checks now from the menu", async () => {
    const calls = fakeApi({
      "GET /api/subscriptions": () => Response.json([subscriptionFixture()]),
      [`POST /api/subscriptions/${SUB_ID}/check`]: () =>
        Response.json(subscriptionFixture(), { status: 202 }),
    });
    await renderInRouter(<SubscriptionsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Blender" }));
    await userEvent.click(await screen.findByText("Check now"));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/check"))).toBe(true);
    });
  });

  it("unsubscribes after confirming", async () => {
    const calls = fakeApi({
      "GET /api/subscriptions": () => Response.json([subscriptionFixture()]),
      [`DELETE /api/subscriptions/${SUB_ID}`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<SubscriptionsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Blender" }));
    await userEvent.click(await screen.findByText("Unsubscribe"));
    expect(await screen.findByText("Unsubscribe from Blender?")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });
});

describe("SubscriptionPage", () => {
  it("shows recent activity with outcomes and reasons", async () => {
    fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({
          items: [
            itemFixture(),
            itemFixture({ videoId: "v2", title: "Live Q&A", outcome: "filtered", reason: "title" }),
            itemFixture({
              videoId: "v3",
              title: "Premiere",
              outcome: "waiting",
              reason: "upcoming",
            }),
          ],
          nextCursor: null,
        }),
      "GET /api/format-profiles": () => Response.json([]),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    const activity = await screen.findByRole("list", { name: "Recent activity" });
    const filtered = within(activity).getByText("Live Q&A").closest("li") as HTMLElement;
    expect(within(filtered).getByText("Filtered")).toBeInTheDocument();
    expect(within(filtered).getByText(/title/)).toBeInTheDocument();
    const waiting = within(activity).getByText("Premiere").closest("li") as HTMLElement;
    expect(within(waiting).getByText("Waiting")).toBeInTheDocument();
    expect(within(activity).getByText("Queued")).toBeInTheDocument();
  });

  it("opens each video on its site, downloads a skipped one, and watches one in the library", async () => {
    const skipped = itemFixture({
      videoId: "old1",
      title: "An old one",
      url: "https://www.youtube.com/watch?v=old1",
      outcome: "existing",
      reason: "there when you subscribed",
      downloadId: null,
      entryId: null,
    });
    const had = itemFixture({ entryId: "0190a3f2-7c1e-7000-8000-0000000000e9" });
    const calls = fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: [had, skipped], nextCursor: null }),
      [`POST /api/subscriptions/${SUB_ID}/items/download`]: () =>
        Response.json({ queued: 1, skipped: 0 }),
      "GET /api/format-profiles": () => Response.json([]),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    const activity = await screen.findByRole("list", { name: "Recent activity" });
    const row = within(activity).getByText("An old one").closest("li") as HTMLElement;
    const link = within(row).getByRole("link", { name: /An old one/ });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=old1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(row).getByText("Skipped")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Download An old one" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/items/download"))?.body).toEqual({
        extractor: "youtube",
        videoId: "old1",
      });
    });
    const watch = within(activity).getByRole("link", { name: `Watch ${had.title ?? ""}` });
    expect(watch).toHaveAttribute("href", `/library/${had.entryId ?? ""}`);
    expect(within(activity).getAllByRole("button", { name: /^Download/ })).toHaveLength(1);
  });

  it("shows a queued video's download as it goes, and Downloaded once it's in the library", async () => {
    const queued = (videoId: string, over: Parameters<typeof itemFixture>[0]) =>
      itemFixture({
        videoId,
        title: videoId,
        outcome: "queued",
        downloadId: `0190a3f2-7c1e-7000-8000-00000000d0${videoId.slice(-1)}0`,
        ...over,
      });
    fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({
          items: [
            queued("waits-1", { downloadState: "queued" }),
            queued("runs-2", { downloadState: "running" }),
            queued("done-3", {
              downloadState: "done",
              entryId: "0190a3f2-7c1e-7000-8000-0000000000e9",
            }),
            queued("fails-4", { downloadState: "failed" }),
            queued("stops-5", { downloadState: "cancelled" }),
          ],
          nextCursor: null,
        }),
      "GET /api/format-profiles": () => Response.json([]),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    const activity = await screen.findByRole("list", { name: "Recent activity" });
    const pill = (title: string) => {
      const row = within(activity).getByText(title).closest("li") as HTMLElement;
      return ["Queued", "Downloading", "Downloaded", "Failed", "Cancelled"].filter(
        (label) => within(row).queryByText(label) !== null,
      );
    };
    expect(pill("waits-1")).toEqual(["Queued"]);
    expect(pill("runs-2")).toEqual(["Downloading"]);
    expect(pill("done-3")).toEqual(["Downloaded"]);
    expect(within(activity).getByRole("link", { name: "Watch done-3" })).toBeInTheDocument();
    expect(pill("fails-4")).toEqual(["Failed"]);
    expect(pill("stops-5")).toEqual(["Cancelled"]);
  });

  it("refreshes the activity when a running check finishes", async () => {
    let subCalls = 0;
    let itemCalls = 0;
    fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () =>
        Response.json(
          ++subCalls === 1
            ? subscriptionFixture({ checking: true, lastCheckedAt: null })
            : subscriptionFixture({ checking: false }),
        ),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: ++itemCalls === 1 ? [] : [itemFixture()], nextCursor: null }),
      "GET /api/format-profiles": () => Response.json([]),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(
      await screen.findByText("Blender 5.3 overview", undefined, { timeout: 6000 }),
    ).toBeInTheDocument();
  }, 10_000);

  it("checks now from its page and pauses it", async () => {
    const calls = fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: [], nextCursor: null }),
      [`POST /api/subscriptions/${SUB_ID}/check`]: () =>
        Response.json(subscriptionFixture(), { status: 202 }),
      [`PATCH /api/subscriptions/${SUB_ID}`]: () =>
        Response.json(subscriptionFixture({ enabled: false })),
      "GET /api/format-profiles": () => Response.json([]),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Check now" }));
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ enabled: false });
    });
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/check"))).toBe(true);
  });
});
