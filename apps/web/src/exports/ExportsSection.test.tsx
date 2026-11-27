import type { Export } from "@uroboros/contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useExports } from "@/api/exports";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter, renderWithQuery } from "@/test/render";

import { ExportsSection } from "./ExportsSection";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;

const copy = (n: number, over: Partial<Export>): Export => ({
  id: id(n),
  entryId: id(100 + n),
  title: `Video ${String(n)}`,
  state: "queued",
  progress: null,
  encoder: null,
  error: null,
  sizeBytes: null,
  keptSeconds: 600,
  cutSeconds: 90,
  createdAt: "2026-11-24T18:00:00.000Z",
  fileUrl: null,
  current: true,
  clip: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExportsSection", () => {
  it("shows nothing without copies", async () => {
    fakeApi({ "GET /api/exports": () => Response.json([]) });
    // The section is empty while loading too: a probe on the same query says when the empty
    // list has arrived.
    function Settled() {
      return useExports().isSuccess ? <p>settled</p> : null;
    }
    const { container } = renderWithQuery(
      <>
        <div data-testid="section">
          <ExportsSection />
        </div>
        <Settled />
      </>,
    );
    await screen.findByText("settled");
    expect(screen.getByTestId("section")).toBeEmptyDOMElement();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("shows each copy's state, how far it is, and a Save once ready", async () => {
    fakeApi({
      "GET /api/exports": () =>
        Response.json([
          copy(1, {}),
          copy(2, { state: "running", progress: 0.42, encoder: "nvenc" }),
          copy(3, {
            state: "done",
            progress: 1,
            sizeBytes: 52_428_800,
            fileUrl: `/api/exports/${id(3)}/file`,
          }),
          copy(4, { state: "failed", error: "Invalid data found when processing input" }),
        ]),
    });
    renderWithQuery(<ExportsSection />);
    const list = within(await screen.findByRole("region", { name: "Copies to save" }));
    const rows = list.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Waiting")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Making")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(within(rows[1] as HTMLElement).getByText(/42% · nvenc/)).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByRole("link", { name: "Save Video 3" }),
    ).toHaveAttribute("href", `/api/exports/${id(3)}/file`);
    expect(within(rows[2] as HTMLElement).getByText("1:30 cut · 50.0 MB")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText(/Invalid data/)).toBeInTheDocument();
  });

  it("removes a copy, and asks again for a failed one", async () => {
    const calls = fakeApi({
      "GET /api/exports": () => Response.json([copy(4, { state: "failed", error: "boom" })]),
      [`DELETE /api/exports/${id(4)}`]: () => new Response(null, { status: 204 }),
      [`POST /api/library/${id(104)}/export`]: () =>
        Response.json(copy(5, { entryId: id(104) }), { status: 201 }),
    });
    renderWithQuery(<ExportsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Try Video 4 again" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Video 4" }));
    await waitFor(() => {
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
        expect.arrayContaining([
          `POST /api/library/${id(104)}/export`,
          `DELETE /api/exports/${id(4)}`,
        ]),
      );
    });
  });

  it("says which range a clip keeps, and asks for the same range again when it failed", async () => {
    const clip = { start: 62, end: 90 };
    const calls = fakeApi({
      "GET /api/exports": () =>
        Response.json([
          copy(6, {
            clip,
            state: "done",
            sizeBytes: 4096,
            fileUrl: `/api/exports/${id(6)}/file`,
          }),
          copy(7, { clip, state: "failed", error: "boom" }),
        ]),
      [`POST /api/library/${id(107)}/export`]: () =>
        Response.json(copy(8, { entryId: id(107), clip }), { status: 201 }),
    });
    await renderInRouter(<ExportsSection />);
    const list = within(await screen.findByRole("region", { name: "Copies to save" }));
    const rows = list.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Clip 1:02–1:30 · 4.0 KB")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Clip 1:02–1:30")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /Watch/ })).toHaveAttribute(
      "href",
      `/shared/clips/${id(6)}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try Video 7 again" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ clip });
    });
  });
});
