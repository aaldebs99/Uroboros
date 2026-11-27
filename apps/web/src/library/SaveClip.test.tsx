import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { SaveFile } from "./SaveFile";

/** Save with a clip picked in the player (docs/sharing.md#clips): just that range, cut by the server. */

const ID = "0190a3f2-7c1e-7000-8000-000000000001";
const CLIP = { start: 62, end: 90 };
const copy = (over: Record<string, unknown> = {}) => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000e2",
  entryId: ID,
  title: "GTA VI at 60 FPS",
  state: "queued",
  progress: null,
  encoder: null,
  error: null,
  sizeBytes: null,
  keptSeconds: 28,
  cutSeconds: 980,
  createdAt: "2026-11-24T18:00:00.000Z",
  fileUrl: null,
  current: true,
  clip: CLIP,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Save with a clip picked", () => {
  it("offers This clip first, even on a video with nothing skipped, and asks the server for that range", async () => {
    const calls = fakeApi({
      [`POST /api/library/${ID}/export`]: () => Response.json(copy(), { status: 201 }),
      "GET /api/exports": () => Response.json([]),
    });
    await renderInRouter(
      <>
        <SaveFile item={{ id: ID, sponsorSegments: [] }} clip={CLIP} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const menu = await screen.findByRole("dialog", { name: "Save" });
    const choices = [...menu.querySelectorAll("a, button")].filter((c) => c.textContent !== "");
    expect(choices.map((c) => c.textContent)).toEqual(["This clip (1:02–1:30)", "Original file"]);
    fireEvent.click(within(menu).getByRole("button", { name: "This clip (1:02–1:30)" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ clip: CLIP });
    });
    expect(await screen.findByText("Making the clip")).toBeInTheDocument();
    expect(screen.getByText("Find it under Downloads › Copies to save.")).toBeInTheDocument();
  });

  it("saves a finished clip of the same range at once", async () => {
    const fileUrl = "/api/exports/0190a3f2-7c1e-7000-8000-0000000000e2/file";
    fakeApi({
      "GET /api/exports": () =>
        Response.json([
          copy({ clip: { start: 62, end: 91 }, state: "done", fileUrl: "/elsewhere" }),
          copy({ state: "done", fileUrl }),
        ]),
    });
    await renderInRouter(<SaveFile item={{ id: ID, sponsorSegments: [] }} clip={CLIP} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const menu = await screen.findByRole("dialog", { name: "Save" });
    expect(
      await within(menu).findByRole("link", { name: "This clip (1:02–1:30)" }),
    ).toHaveAttribute("href", fileUrl);
  });
});
