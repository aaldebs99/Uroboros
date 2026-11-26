import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";
import { SUB_ID, subscriptionFixture } from "@/test/subscriptions";

import { NewSubscriptionPage } from "./NewSubscriptionPage";
import { SubscriptionPage } from "./SubscriptionPage";

const REQ = "0190a3f2-7c1e-7000-8000-0000000000d1";
const PROFILE = "0190a3f2-7c1e-7000-8000-000000000001";
const base = "https://www.youtube.com/@BlenderOfficial";

const profiles = [
  {
    id: PROFILE,
    name: "Best up to 1080p (MP4)",
    format: "b",
    mergeFormat: null,
    videoCodec: null,
    audioOnly: false,
    audioFormat: null,
    extraArgs: [],
    builtIn: true,
    isDefault: true,
    revision: "r",
  },
];

const group = (name: string, url: string, ticked: boolean) => ({
  name,
  url,
  ticked,
  truncated: false,
  entries: [],
});

const request = (kind: "channel" | "playlist") => ({
  id: REQ,
  url: kind === "channel" ? base : "https://www.youtube.com/playlist?list=PL1",
  profileId: PROFILE,
  state: "choosing",
  kind,
  title: kind === "channel" ? "Blender" : "Open movies",
  groups:
    kind === "channel"
      ? [
          group("Videos", `${base}/videos`, true),
          group("Shorts", `${base}/shorts`, false),
          group("Live", `${base}/streams`, false),
        ]
      : [group("Open movies", "https://www.youtube.com/playlist?list=PL1", true)],
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  retryAt: null,
  selected: null,
  createdAt: "2026-11-23T08:00:00.000Z",
});

function newApi(kind: "channel" | "playlist") {
  return fakeApi({
    [`GET /api/downloads/requests/${REQ}`]: () => Response.json(request(kind)),
    "GET /api/format-profiles": () => Response.json(profiles),
    "POST /api/subscriptions": () => Response.json(subscriptionFixture(), { status: 201 }),
    [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
    [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
      Response.json({ items: [], nextCursor: null }),
  });
}

describe("SubscriptionForm", () => {
  it("builds the body from a channel preview", async () => {
    const calls = newApi("channel");
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Live" }));
    await userEvent.clear(screen.getByLabelText("Check every"));
    await userEvent.type(screen.getByLabelText("Check every"), "12");
    await userEvent.click(screen.getByRole("radio", { name: /The newest/ }));
    await userEvent.clear(screen.getByLabelText("How many of each tab"));
    await userEvent.type(screen.getByLabelText("How many of each tab"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
        requestId: REQ,
        feeds: ["Videos", "Live"],
        profileId: PROFILE,
        schedule: { kind: "interval", minutes: 720 },
        backfill: { mode: "newest", count: 5 },
        notify: true,
      });
    });
  });

  it("checks on a cron schedule in the browser's timezone, and caps the newest at 50", async () => {
    const calls = newApi("channel");
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    await userEvent.click(await screen.findByRole("radio", { name: "On a cron schedule" }));
    const cron = screen.getByLabelText("Cron schedule");
    await userEvent.clear(cron);
    await userEvent.type(cron, "30 7 * * 1");
    await userEvent.click(screen.getByRole("radio", { name: /The newest/ }));
    const count = screen.getByLabelText("How many of each tab");
    expect(count).toHaveAttribute("max", "50");
    await userEvent.clear(count);
    await userEvent.type(count, "50");
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
        schedule: {
          kind: "cron",
          expression: "30 7 * * 1",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        backfill: { mode: "newest", count: 50 },
      });
    });
  });

  it("checks only when asked, and leaves new videos to pick, with no wait to choose", async () => {
    const calls = newApi("channel");
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Manually" }));
    expect(screen.queryByLabelText("Check every")).not.toBeInTheDocument();
    expect(screen.getByText(/Only when you press Check now/)).toBeInTheDocument();
    expect(screen.getByLabelText("Wait before downloading")).toBeInTheDocument();
    const auto = screen.getByRole("switch", { name: "Download new videos automatically" });
    expect(auto).toBeChecked();
    await userEvent.click(auto);
    expect(screen.queryByLabelText("Wait before downloading")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
        schedule: { kind: "manual" },
        autoDownload: false,
      });
    });
  });

  it("hides newest backfill for playlists and shows Exclude Shorts", async () => {
    newApi("playlist");
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    expect(await screen.findByRole("checkbox", { name: "Exclude Shorts" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /The newest/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All of them" })).toBeInTheDocument();
  });

  it("warns when the backfill exceeds what retention keeps", async () => {
    newApi("channel");
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    await userEvent.click(await screen.findByRole("radio", { name: "All of them" }));
    await userEvent.type(screen.getByLabelText("Keep only the newest"), "10");
    expect(await screen.findByText(/Retention keeps 10/)).toBeInTheDocument();
  });

  it("downloads a subscription's latest N from its page", async () => {
    const calls = fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: [], nextCursor: null }),
      "GET /api/format-profiles": () => Response.json(profiles),
      [`POST /api/subscriptions/${SUB_ID}/latest`]: () => new Response(null, { status: 202 }),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Download latest…" }));
    const dialog = screen.getByRole("dialog", { name: "Download the latest videos" });
    const count = within(dialog).getByLabelText("How many of each tab");
    expect(count).toHaveAttribute("max", "50");
    await userEvent.clear(count);
    await userEvent.type(count, "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith("/latest"))?.body).toEqual({ count: 5 });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("links back to the subscriptions list, even when the subscription is gone", async () => {
    fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () =>
        Response.json({ code: "not_found", message: "no such subscription" }, { status: 404 }),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    expect(await screen.findByRole("link", { name: "Subscriptions" })).toHaveAttribute(
      "href",
      "/subscriptions",
    );
  });

  it("switches a subscription to manual checks without auto-download, sending only that", async () => {
    const calls = fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: [], nextCursor: null }),
      "GET /api/format-profiles": () => Response.json(profiles),
      [`PATCH /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Manually" }));
    expect(screen.getByText("Only when you press Check now.")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("switch", { name: "Download new videos automatically" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        schedule: { kind: "manual" },
        autoDownload: false,
      });
    });
  });

  it("edits a subscription's filters", async () => {
    const calls = fakeApi({
      [`GET /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
      [`GET /api/subscriptions/${SUB_ID}/items`]: () =>
        Response.json({ items: [], nextCursor: null }),
      "GET /api/format-profiles": () => Response.json(profiles),
      [`PATCH /api/subscriptions/${SUB_ID}`]: () => Response.json(subscriptionFixture()),
    });
    await renderInRouter(<SubscriptionPage subscriptionId={SUB_ID} />);
    await userEvent.type(await screen.findByLabelText("Title must not match"), "live");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        filters: {
          titleInclude: null,
          titleExclude: "live",
          minDuration: null,
          maxDuration: null,
          uploadedAfter: null,
          excludeShorts: false,
          excludeLive: false,
        },
      });
    });
  });
});
