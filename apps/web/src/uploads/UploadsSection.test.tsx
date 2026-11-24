import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { fakeXhr } from "@/test/fakeXhr";
import { expectLabelShowsFocus } from "@/test/focusRing";
import { renderInRouter } from "@/test/render";

import { UploadProvider } from "./UploadProvider";
import { UploadsSection } from "./UploadsSection";

const base = {
  filename: "trip.mp4",
  size: 10,
  partSize: 4,
  receivedParts: [1],
  error: null,
  entryId: null,
  createdAt: "2026-11-24T10:00:00.000Z",
};
const paused = {
  ...base,
  id: "0190a3f2-7c1e-7000-8000-0000000000f1",
  title: "Trip",
  state: "receiving",
};
const busy = {
  ...base,
  id: "0190a3f2-7c1e-7000-8000-0000000000f2",
  title: "Busy",
  state: "processing",
};
const failed = {
  ...base,
  id: "0190a3f2-7c1e-7000-8000-0000000000f3",
  title: "Broken",
  state: "failed",
  error: "That file has no video we can read",
};

afterEach(() => {
  vi.unstubAllGlobals();
  // Sonner replays toasts still showing to the next test's Toaster.
  toast.dismiss();
});

async function show(extra: Parameters<typeof fakeApi>[0] = {}) {
  const calls = fakeApi({
    "GET /api/uploads": () => Response.json([paused, busy, failed]),
    ...extra,
  });
  await renderInRouter(
    <UploadProvider pollMs={5}>
      <UploadsSection />
      <Toaster />
    </UploadProvider>,
  );
  const section = await screen.findByRole("region", { name: "Uploads" });
  return { calls, section };
}

describe("UploadsSection", () => {
  it("lists unfinished and failed uploads with what each needs", async () => {
    const { section } = await show();
    const rows = await within(section).findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0] ?? section).getByText("Paused")).toBeInTheDocument();
    expect(within(rows[0] ?? section).getByText(/choose trip\.mp4 again/i)).toBeInTheDocument();
    expect(within(rows[1] ?? section).getByText("Processing")).toBeInTheDocument();
    expect(within(rows[2] ?? section).getByText("Failed")).toBeInTheDocument();
    expect(
      within(rows[2] ?? section).getByText("That file has no video we can read"),
    ).toBeInTheDocument();
  });

  it("shows keyboard focus on Choose the file", async () => {
    const { section } = await show();
    expectLabelShowsFocus(await within(section).findByLabelText("Choose trip.mp4 again"));
  });

  it("dismisses a failed upload, and cancels a paused one", async () => {
    const { calls, section } = await show({
      [`DELETE /api/uploads/${failed.id}`]: () => new Response(null, { status: 204 }),
      [`DELETE /api/uploads/${paused.id}`]: () => new Response(null, { status: 204 }),
    });
    await userEvent.click(await within(section).findByRole("button", { name: "Dismiss Broken" }));
    await userEvent.click(within(section).getByRole("button", { name: "Cancel Trip" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
        `/api/uploads/${failed.id}`,
        `/api/uploads/${paused.id}`,
      ]);
    });
  });

  it("resumes with the same file only, sending just the parts the server lacks", async () => {
    const { calls, section } = await show({
      [`POST /api/uploads/${paused.id}/complete`]: () =>
        Response.json({ ...paused, state: "processing" }),
      [`GET /api/uploads/${paused.id}`]: () =>
        Response.json({
          ...paused,
          state: "done",
          entryId: "0190a3f2-7c1e-7000-8000-0000000000f9",
        }),
    });
    const sent = fakeXhr();
    const input = await within(section).findByLabelText("Choose trip.mp4 again");
    await userEvent.upload(input, new File(["short"], "trip.mp4", { type: "video/mp4" }));
    expect(await screen.findByText(/not the same file/i)).toBeInTheDocument();
    expect(sent).toEqual([]);
    await userEvent.upload(input, new File(["abcdefghij"], "trip.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("Uploaded: Trip")).toBeInTheDocument();
    expect(sent.map((s) => s.path)).toEqual([
      `/api/uploads/${paused.id}/parts/2`,
      `/api/uploads/${paused.id}/parts/3`,
    ]);
    expect(calls.some((c) => c.path === `/api/uploads/${paused.id}/complete`)).toBe(true);
  });
});
