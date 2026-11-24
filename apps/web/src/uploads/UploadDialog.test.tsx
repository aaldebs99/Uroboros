import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { fakeXhr } from "@/test/fakeXhr";
import { expectLabelShowsFocus } from "@/test/focusRing";
import { renderInRouter } from "@/test/render";

import { UploadDialog } from "./UploadDialog";
import { UploadProvider } from "./UploadProvider";

const UID = "0190a3f2-7c1e-7000-8000-0000000000e1";
const ENTRY = "0190a3f2-7c1e-7000-8000-0000000000e2";
const upload = {
  id: UID,
  filename: "Holiday trip.mp4",
  title: "Holiday trip",
  size: 10,
  partSize: 4,
  state: "receiving",
  receivedParts: [],
  error: null,
  entryId: null,
  createdAt: "2026-11-24T10:00:00.000Z",
};
const video = () => new File(["abcdefghij"], "Holiday trip.mp4", { type: "video/mp4" });

afterEach(() => {
  vi.unstubAllGlobals();
  // Sonner replays toasts still showing to the next test's Toaster.
  toast.dismiss();
});

async function open(onOpenChange = vi.fn()) {
  await renderInRouter(
    <UploadProvider pollMs={5} retryMs={1}>
      <UploadDialog open onOpenChange={onOpenChange} creator="Alice" />
      <Toaster />
    </UploadProvider>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Upload a video" });
  return { dialog, onOpenChange };
}

function serverFlow() {
  let polls = 0;
  return fakeApi({
    "POST /api/uploads": () => Response.json(upload, { status: 201 }),
    [`POST /api/uploads/${UID}/complete`]: () =>
      Response.json({ ...upload, state: "processing", receivedParts: [1, 2, 3] }),
    [`GET /api/uploads/${UID}`]: () => {
      polls++;
      return Response.json(
        polls < 2
          ? { ...upload, state: "processing" }
          : { ...upload, state: "done", entryId: ENTRY },
      );
    },
    [`DELETE /api/uploads/${UID}`]: () => new Response(null, { status: 204 }),
    "GET /api/uploads": () => Response.json([]),
  });
}

describe("UploadDialog after the parts are in", () => {
  const done = { ...upload, state: "done", entryId: ENTRY };

  it("rides out a server that fails while completing and while checking", async () => {
    let completes = 0;
    let checks = 0;
    fakeApi({
      "POST /api/uploads": () => Response.json(upload, { status: 201 }),
      [`POST /api/uploads/${UID}/complete`]: () =>
        ++completes === 1
          ? Response.json({ code: "unavailable", message: "deploying" }, { status: 503 })
          : Response.json({ ...upload, state: "processing" }),
      [`GET /api/uploads/${UID}`]: () =>
        ++checks === 1
          ? Response.json({ code: "unavailable", message: "deploying" }, { status: 503 })
          : Response.json(done),
      "GET /api/uploads": () => Response.json([]),
    });
    fakeXhr();
    const { dialog } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Uploaded: Holiday trip")).toBeInTheDocument();
    expect(screen.queryByText(/is paused/)).not.toBeInTheDocument();
  });

  it("waits for the video when a complete it lost the answer to had landed (409)", async () => {
    fakeApi({
      "POST /api/uploads": () => Response.json(upload, { status: 201 }),
      [`POST /api/uploads/${UID}/complete`]: () =>
        Response.json(
          { code: "conflict", message: "this upload has all its parts" },
          { status: 409 },
        ),
      [`GET /api/uploads/${UID}`]: () => Response.json(done),
      "GET /api/uploads": () => Response.json([]),
    });
    fakeXhr();
    const { dialog } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Uploaded: Holiday trip")).toBeInTheDocument();
  });

  it("on Try again, picks up from what the server has: here, the finished video", async () => {
    let finished = false;
    fakeApi({
      "POST /api/uploads": () => Response.json(upload, { status: 201 }),
      [`POST /api/uploads/${UID}/complete`]: () =>
        Response.json({ code: "unavailable", message: "down" }, { status: 503 }),
      [`GET /api/uploads/${UID}`]: () =>
        Response.json(finished ? done : { ...upload, receivedParts: [1, 2, 3] }),
      "GET /api/uploads": () => Response.json([]),
    });
    const parts = fakeXhr();
    const { dialog } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await within(dialog).findByRole("button", { name: "Try again" });
    finished = true;
    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Uploaded: Holiday trip")).toBeInTheDocument();
    expect(parts).toHaveLength(3);
  });
});

describe("UploadDialog", () => {
  it("uploads a video with its details in parts, then says it is in the library", async () => {
    const calls = serverFlow();
    const parts = fakeXhr();
    const { dialog, onOpenChange } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Holiday trip");
    expect(within(dialog).getByLabelText("Creator")).toHaveValue("Alice");
    await userEvent.type(within(dialog).getByLabelText("Description"), "Day one");
    await userEvent.type(within(dialog).getByLabelText("Tags"), "Beach, sea, beach");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Uploaded: Holiday trip")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/uploads")?.body).toEqual({
      filename: "Holiday trip.mp4",
      size: 10,
      title: "Holiday trip",
      description: "Day one",
      creator: "Alice",
      tags: ["beach", "sea"],
    });
    expect(parts.map((p) => [p.method, p.path, p.size])).toEqual([
      ["PUT", `/api/uploads/${UID}/parts/1`, 4],
      ["PUT", `/api/uploads/${UID}/parts/2`, 4],
      ["PUT", `/api/uploads/${UID}/parts/3`, 2],
    ]);
    expect(calls.some((c) => c.path === `/api/uploads/${UID}/complete`)).toBe(true);
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows keyboard focus on its file and thumbnail buttons", async () => {
    fakeApi({});
    const { dialog } = await open();
    expectLabelShowsFocus(within(dialog).getByLabelText("Choose a video"));
    expectLabelShowsFocus(within(dialog).getByLabelText("Choose a thumbnail"));
  });

  it("checks the file and the title before sending anything", async () => {
    const calls = serverFlow();
    const { dialog } = await open();
    await userEvent.upload(
      within(dialog).getByLabelText("Choose a video"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
      { applyAccept: false },
    );
    expect(
      await within(dialog).findByText("Uploads must be MP4, M4V, MOV, WebM, MKV or AVI files."),
    ).toBeInTheDocument();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.clear(within(dialog).getByLabelText("Title"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByText("Give it a title.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("says how large a video may be when the file is too big", async () => {
    fakeApi({
      "POST /api/uploads": () =>
        Response.json(
          { code: "payload_too_large", message: "videos of up to 10 GiB can be uploaded" },
          { status: 413 },
        ),
    });
    const { dialog } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(
      await within(dialog).findByText("Videos of up to 10 GiB can be uploaded."),
    ).toBeInTheDocument();
  });

  it("sends the picked thumbnail before the parts", async () => {
    serverFlow();
    const sent = fakeXhr();
    const { dialog } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "cover.png", {
      type: "image/png",
    });
    await userEvent.upload(within(dialog).getByLabelText("Choose a thumbnail"), image);
    expect(await within(dialog).findByAltText("The new thumbnail")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await screen.findByText("Uploaded: Holiday trip");
    expect(sent[0]).toMatchObject({ path: `/api/uploads/${UID}/thumbnail`, size: 4 });
    expect(sent[0]?.headers["Content-Type"]).toBe("image/png");
  });

  it("shows the bytes sent, and cancels the upload", async () => {
    const calls = serverFlow();
    fakeXhr((_m, path) =>
      path.endsWith("/parts/1") ? { status: 204 } : new Promise<never>(() => undefined),
    );
    const { dialog, onOpenChange } = await open();
    await userEvent.upload(within(dialog).getByLabelText("Choose a video"), video());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    const bar = await within(dialog).findByRole("progressbar", { name: "Holiday trip upload" });
    await waitFor(() => {
      expect(bar).toHaveAttribute("aria-valuenow", "40");
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path === `/api/uploads/${UID}`)).toBe(
        true,
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
