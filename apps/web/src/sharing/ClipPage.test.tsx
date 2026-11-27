import { screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ClipPage } from "./ClipPage";

/** A clip shared on its own (docs/sharing.md#clips), on its page under Shared. */

vi.mock("../library/Player", () => ({
  Player: (props: { src: string; chapters: unknown[] }) => (
    <div data-testid="player" data-src={props.src} data-chapters={String(props.chapters.length)} />
  ),
}));

beforeAll(async () => {
  await import("../library/Player");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ID = "0190a3f2-7c1e-7000-8000-000000000002";
const clip = (over: Record<string, unknown> = {}) => ({
  id: ID,
  title: "Holiday (clip 1:02–1:30)",
  channel: "Blender",
  range: { start: 62, end: 90 },
  duration: 28,
  state: "done",
  progress: 1,
  error: null,
  thumbnailUrl: null,
  chapters: [{ start: 0, end: 28, title: "Beach" }],
  streamUrl: `/api/clips/${ID}/stream`,
  fileUrl: `/api/clips/${ID}/file`,
  audioOnly: false,
  owner: "Alice",
  ...over,
});

describe("a shared clip's page", () => {
  it("plays the clip, says who shared it, and saves it", async () => {
    fakeApi({ [`GET /api/clips/${ID}`]: () => Response.json(clip()) });
    await renderInRouter(<ClipPage exportId={ID} />);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-src", `/api/clips/${ID}/stream`);
    expect(player).toHaveAttribute("data-chapters", "1");
    expect(screen.getByRole("heading", { name: "Holiday (clip 1:02–1:30)" })).toBeInTheDocument();
    expect(screen.getByText("Shared by Alice")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Save/ })).toHaveAttribute(
      "href",
      `/api/clips/${ID}/file`,
    );
  });

  it("says the clip is being made, and how far it is", async () => {
    fakeApi({
      [`GET /api/clips/${ID}`]: () =>
        Response.json(clip({ state: "running", progress: 0.4, streamUrl: null, fileUrl: null })),
    });
    await renderInRouter(<ClipPage exportId={ID} />);
    expect(await screen.findByText("This clip is being made.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.queryByTestId("player")).toBeNull();
  });

  it("says so when it is no longer shared", async () => {
    fakeApi({
      [`GET /api/clips/${ID}`]: () =>
        Response.json({ code: "not_found", message: "no such clip" }, { status: 404 }),
    });
    await renderInRouter(<ClipPage exportId={ID} />);
    expect(await screen.findByText("This clip isn't shared with you")).toBeInTheDocument();
  });
});
