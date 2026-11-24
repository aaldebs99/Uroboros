import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify, Toaster } from "@/components/ui/sonner";
import { LiveEventsProvider } from "@/downloads/LiveEvents";
import { copyFixture, downloadFixture, noticeFixture } from "@/test/activity";
import { type Handler, fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { bellLabel, NoticesButton } from "./NoticesButton";

/** A stand-in EventSource the test can push messages through. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {}
}

const newest = noticeFixture({
  id: "0190a3f2-7c1e-7000-8000-0000000000f2",
  title: "2 new videos from Blender",
  body: "Sprite Fright\nCharge",
  kind: "subscriptions",
  path: "/subscriptions/s1",
  createdAt: "2026-11-24T18:05:00.000Z",
});
const older = noticeFixture({ read: true });

function api(over: Record<string, Handler> = {}) {
  return fakeApi({
    "GET /api/notices": () => Response.json({ notices: [newest, older], unread: 1 }),
    "GET /api/downloads": () => Response.json([downloadFixture()]),
    "GET /api/uploads": () => Response.json([]),
    "GET /api/exports": () => Response.json([copyFixture()]),
    "GET /api/subscriptions": () => Response.json([]),
    "POST /api/notices/read": () => new Response(null, { status: 204 }),
    "DELETE /api/notices": () => new Response(null, { status: 204 }),
    ...over,
  });
}

const show = () =>
  renderInRouter(
    <LiveEventsProvider>
      <NoticesButton />
    </LiveEventsProvider>,
  );

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  toast.dismiss();
});

describe("bellLabel", () => {
  it("says what is unread and in progress", () => {
    expect(bellLabel(0, 0)).toBe("Notifications");
    expect(bellLabel(2, 1)).toBe("Notifications, 2 unread, 1 in progress");
  });
});

describe("NoticesButton", () => {
  it("counts the unread, and opening lists them and marks them read up to the newest", async () => {
    const calls = api();
    await show();
    const bell = await screen.findByRole("button", {
      name: "Notifications, 1 unread, 2 in progress",
    });
    expect(bell).toHaveTextContent("1");
    await userEvent.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    const fresh = within(panel).getByRole("link", { name: /2 new videos from Blender/ });
    expect(fresh).toHaveAttribute("href", "/subscriptions/s1");
    expect(fresh).toHaveTextContent("Unread");
    expect(
      within(panel).getByRole("link", { name: /Ready: Big Buck Bunny/ }),
    ).not.toHaveTextContent("Unread");
    await waitFor(() => {
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/notices/read",
        body: { upTo: newest.createdAt },
      });
    });
  });

  it("shows work in progress with its live progress", async () => {
    api();
    await show();
    await userEvent.click(await screen.findByRole("button", { name: /2 in progress/ }));
    const work = await screen.findByRole("region", { name: "In progress" });
    act(() => {
      FakeEventSource.last?.push({
        type: "progress",
        fetchKey: downloadFixture().fetchKey,
        progress: {
          phase: "downloading",
          percent: 42,
          downloadedBytes: 42,
          totalBytes: 100,
          speed: 1024,
          eta: 30,
        },
      });
    });
    expect(
      await within(work).findByRole("progressbar", { name: "Big Buck Bunny progress" }),
    ).toHaveAttribute("aria-valuenow", "42");
    expect(within(work).getByRole("progressbar", { name: /no sponsors/ })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(within(work).getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/downloads",
    );
  });

  it("follows a download as it finishes", async () => {
    api();
    await show();
    await screen.findByRole("button", { name: /2 in progress/ });
    act(() => {
      FakeEventSource.last?.push({
        type: "state",
        download: downloadFixture({ state: "done", finishedAt: "2026-11-24T18:06:00.000Z" }),
      });
    });
    expect(await screen.findByRole("button", { name: /1 in progress/ })).toBeInTheDocument();
  });

  it("fetches the notifications again when the stream says they changed", async () => {
    let unread = 1;
    api({ "GET /api/notices": () => Response.json({ notices: [newest], unread }) });
    await show();
    await screen.findByRole("button", { name: /1 unread/ });
    unread = 3;
    act(() => {
      FakeEventSource.last?.push({ type: "notice" });
    });
    expect(await screen.findByRole("button", { name: /3 unread/ })).toBeInTheDocument();
  });

  it("lists this tab's toasts, whose action runs and closes the panel", async () => {
    api();
    await show();
    const onClick = vi.fn();
    act(() => {
      notify.success("Queued", { detail: "Big Buck Bunny", action: { label: "View", onClick } });
    });
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    const toasts = await screen.findByRole("region", { name: "Earlier in this tab" });
    expect(toasts).toHaveTextContent("Big Buck Bunny");
    await userEvent.click(within(toasts).getByRole("button", { name: "View" }));
    expect(onClick).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    });
  });

  it("dismisses the toasts on screen when it opens, keeping them in its list", async () => {
    api();
    await renderInRouter(
      <LiveEventsProvider>
        <NoticesButton />
        <Toaster />
      </LiveEventsProvider>,
    );
    act(() => {
      notify.success("Saved to Watch later.");
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved to Watch later.");
    await userEvent.click(await screen.findByRole("button", { name: /1 unread/ }));
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "Earlier in this tab" })).toHaveTextContent(
      "Saved to Watch later.",
    );
  });

  it("is all caught up with nothing to show", async () => {
    api({
      "GET /api/notices": () => Response.json({ notices: [], unread: 0 }),
      "GET /api/downloads": () => Response.json([]),
      "GET /api/exports": () => Response.json([]),
    });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByText("You're all caught up")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("clears the notifications and the toasts", async () => {
    const calls = api();
    await show();
    act(() => {
      notify.success("Saved.");
    });
    await userEvent.click(await screen.findByRole("button", { name: /1 unread/ }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await userEvent.click(within(panel).getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ method: "DELETE", path: "/api/notices", body: undefined });
    });
    expect(within(panel).queryByRole("region", { name: "Earlier in this tab" })).toBeNull();
  });

  it("opens as a popover on wide screens", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(min-width: 48rem)",
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    api();
    await show();
    await userEvent.click(await screen.findByRole("button", { name: /1 unread/ }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(panel).toHaveAttribute("data-slot", "popover-content");
  });
});
