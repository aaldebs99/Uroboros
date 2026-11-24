import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { SaveFile } from "./SaveFile";

const ID = "0190a3f2-7c1e-7000-8000-000000000001";
const COPY = {
  id: "0190a3f2-7c1e-7000-8000-0000000000e1",
  entryId: ID,
  title: "GTA VI at 60 FPS",
  state: "queued",
  progress: null,
  encoder: null,
  error: null,
  sizeBytes: null,
  keptSeconds: 903.5,
  cutSeconds: 104.5,
  createdAt: "2026-11-24T18:00:00.000Z",
  fileUrl: null,
  current: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SaveFile", () => {
  it("is the file itself on a video with no segments", async () => {
    await renderInRouter(<SaveFile item={{ id: ID, skipSegments: [] }} />);
    expect(screen.getByRole("link", { name: "Save" })).toHaveAttribute(
      "href",
      `/api/library/${ID}/file`,
    );
  });

  it("offers the original file or a copy without sponsors, which it asks the server for", async () => {
    const calls = fakeApi({
      [`POST /api/library/${ID}/export`]: () => Response.json(COPY, { status: 201 }),
      "GET /api/exports": () => Response.json([COPY]),
    });
    await renderInRouter(
      <>
        <SaveFile item={{ id: ID, skipSegments: [{ start: 49, end: 69, category: "sponsor" }] }} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const menu = await screen.findByRole("dialog", { name: "Save" });
    expect(within(menu).getByRole("link", { name: "Original file" })).toHaveAttribute(
      "href",
      `/api/library/${ID}/file`,
    );
    fireEvent.click(within(menu).getByRole("button", { name: "Without sponsors" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === `/api/library/${ID}/export`)).toBe(
        true,
      );
    });
    expect(await screen.findByText("Making a copy without sponsors")).toBeInTheDocument();
  });

  it("saves a copy made already at once, asking the server for nothing", async () => {
    const done = {
      ...COPY,
      state: "done",
      progress: 1,
      sizeBytes: 10,
      fileUrl: `/api/exports/${COPY.id}/file`,
    };
    const calls = fakeApi({ "GET /api/exports": () => Response.json([done]) });
    await renderInRouter(
      <SaveFile item={{ id: ID, skipSegments: [{ start: 49, end: 69, category: "sponsor" }] }} />,
    );
    await waitFor(() => {
      expect(calls.some((c) => c.path === "/api/exports")).toBe(true);
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const menu = await screen.findByRole("dialog", { name: "Save" });
    await waitFor(() => {
      expect(within(menu).getByRole("link", { name: "Without sponsors" })).toHaveAttribute(
        "href",
        `/api/exports/${COPY.id}/file`,
      );
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("asks for a new copy when the one made was cut from segments a refetch changed", async () => {
    const stale = {
      ...COPY,
      state: "done",
      progress: 1,
      sizeBytes: 10,
      fileUrl: `/api/exports/${COPY.id}/file`,
      current: false,
    };
    const calls = fakeApi({
      [`POST /api/library/${ID}/export`]: () => Response.json(COPY, { status: 201 }),
      "GET /api/exports": () => Response.json([stale]),
    });
    await renderInRouter(
      <SaveFile item={{ id: ID, skipSegments: [{ start: 49, end: 69, category: "sponsor" }] }} />,
    );
    await waitFor(() => {
      expect(calls.some((c) => c.path === "/api/exports")).toBe(true);
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const menu = await screen.findByRole("dialog", { name: "Save" });
    expect(within(menu).queryByRole("link", { name: "Without sponsors" })).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: "Without sponsors" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === `/api/library/${ID}/export`)).toBe(
        true,
      );
    });
  });
});
