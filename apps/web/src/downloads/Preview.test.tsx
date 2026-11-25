import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { RequestPanel } from "./Preview";

const ID = "0190a3f2-7c1e-7000-8000-0000000000e1";

const entry = (id: string) => ({
  id,
  extractor: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Video ${id}`,
  duration: 61,
  uploader: "Blender",
  thumbnailUrl: null,
});

const preview = (selected: string[] | null) => ({
  id: ID,
  url: "https://www.youtube.com/@BlenderOfficial",
  profileId: "0190a3f2-7c1e-7000-8000-0000000000a1",
  state: "choosing",
  kind: "channel",
  title: "Blender",
  groups: [
    { name: "Videos", ticked: true, truncated: false, entries: [entry("v1"), entry("v2")] },
    { name: "Shorts", ticked: false, truncated: false, entries: [entry("s1")] },
  ],
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  retryAt: null,
  selected,
  createdAt: "2026-11-22T10:00:00.000Z",
});

const show = () =>
  renderWithQuery(
    <>
      <RequestPanel id={ID} onDone={() => undefined} />
      <Toaster />
    </>,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a preview's picks", () => {
  it("opens with the picks saved earlier rather than the groups' ticks", async () => {
    fakeApi({ [`GET /api/downloads/requests/${ID}`]: () => Response.json(preview(["v2", "s1"])) });
    show();
    expect(await screen.findByRole("checkbox", { name: "Video v2" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Video v1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Video s1" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Queue 2 videos" })).toBeEnabled();
  });

  it("saves the picks a moment after the last change, once for a burst of them", async () => {
    const calls = fakeApi({
      [`GET /api/downloads/requests/${ID}`]: () => Response.json(preview(null)),
      [`PUT /api/downloads/requests/${ID}/selection`]: () => new Response(null, { status: 204 }),
    });
    show();
    const v1 = await screen.findByRole("checkbox", { name: "Video v1" });
    const saves = () => calls.filter((c) => c.method === "PUT");
    // The clock is the test's from here: two real clicks could land either side of the 400 ms
    // debounce on a slow runner.
    vi.useFakeTimers();
    fireEvent.click(v1);
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.click(screen.getByRole("checkbox", { name: "Video s1" }));
    await vi.advanceTimersByTimeAsync(399);
    expect(saves()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves()).toEqual([
      expect.objectContaining({ method: "PUT", body: { entryIds: ["v2", "s1"] } }),
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves()).toHaveLength(1);
  });

  it("says when a save failed, keeping the picks on screen", async () => {
    fakeApi({
      [`GET /api/downloads/requests/${ID}`]: () => Response.json(preview(null)),
      [`PUT /api/downloads/requests/${ID}/selection`]: () =>
        Response.json(
          { code: "conflict", message: "this request has no preview" },
          { status: 409 },
        ),
    });
    show();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Video v1" }));
    expect(await screen.findByText(/Couldn't save your picks/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Video v1" })).not.toBeChecked();
  });

  it("says when a link waiting out its site's rate limit is looked at again", async () => {
    const retryAt = "2026-11-25T14:05:00.000Z";
    fakeApi({
      [`GET /api/downloads/requests/${ID}`]: () =>
        Response.json({
          ...preview(null),
          state: "probing",
          kind: null,
          groups: [],
          errorKind: "rate_limited",
          retryAt,
        }),
    });
    show();
    const at = new Date(retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(
      await screen.findByText(`The site is limiting requests. Trying again at ${at}.`),
    ).toBeInTheDocument();
    expect(screen.getByText(/Looking at the link/)).toBeInTheDocument();
  });

  it("says a preview that is gone expired", async () => {
    fakeApi({});
    show();
    expect(
      await screen.findByText("This preview expired. A preview waits a day for a pick."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Looking at the link")).not.toBeInTheDocument();
  });
});
