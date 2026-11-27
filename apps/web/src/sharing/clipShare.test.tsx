import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi, type Handler } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ShareDialog } from "./ShareDialog";

/**
 * Sharing with a clip picked (docs/sharing.md#clips): only the clip (its own cut file, made at the
 * first share action), or the whole video opened at it.
 */

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const ENTRY = id(1);
const COPY = id(2);
const BOB = id(50);
const CLIP = { start: 62, end: 90 };
const CODE = "AbCdEfGhIjKlMnOpQrStUv";

const state = (kind: "entry" | "clip", over: Record<string, unknown> = {}) => ({
  kind,
  id: kind === "entry" ? ENTRY : COPY,
  title: kind === "entry" ? "Holiday" : "Holiday (clip 1:02–1:30)",
  thumbnailUrl: null,
  people: null,
  link: null,
  updatedAt: null,
  ...over,
});
const link = {
  code: CODE,
  path: `/s/${CODE}`,
  allowDownload: false,
  expiresAt: null,
  expired: false,
};
const copy = (clip: unknown = CLIP, over: Record<string, unknown> = {}) => ({
  id: COPY,
  entryId: ENTRY,
  title: "Holiday",
  state: "queued",
  progress: null,
  encoder: null,
  error: null,
  sizeBytes: null,
  keptSeconds: 28,
  cutSeconds: 572,
  createdAt: "2026-11-24T18:00:00.000Z",
  fileUrl: null,
  current: true,
  clip,
  ...over,
});
// A clip to the player's end, a frame past the file's: the server ends it at the file's end, 600.
const TO_END = { start: 62, end: 600.04 };
const ended = (over: Record<string, unknown> = {}) =>
  copy({ start: 62, end: 600 }, { cutSeconds: 62, keptSeconds: 538, ...over });

const directory = { users: [{ id: BOB, name: "Bob", handle: "bob" }], groups: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(routes: Record<string, Handler>, clip = CLIP) {
  const calls = fakeApi({
    [`GET /api/shares/entry/${ENTRY}`]: () => Response.json(state("entry", { link })),
    "GET /api/directory": () => Response.json(directory),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "0", publicBaseUrl: null, clips: true }),
    ...routes,
  });
  await renderInRouter(
    <>
      <ShareDialog
        kind="entry"
        id={ENTRY}
        title="Holiday"
        clip={clip}
        open
        onOpenChange={() => undefined}
      />
      <Toaster />
    </>,
  );
  return calls;
}

describe("sharing with a clip picked", () => {
  it("offers only the clip first, and asks for no copy just by opening", async () => {
    const calls = await open({ "GET /api/exports": () => Response.json([]) });
    expect(await screen.findByRole("radio", { name: /Only the clip \(1:02–1:30\)/ })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /The whole video, opened at the clip/ }),
    ).not.toBeChecked();
    await screen.findByRole("switch", { name: "Public link" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("makes the clip at the first share action, then shares the clip's copy", async () => {
    let made = false;
    const calls = await open({
      "GET /api/exports": () => Response.json(made ? [copy()] : []),
      [`POST /api/library/${ENTRY}/export`]: () => {
        made = true;
        return Response.json(copy(), { status: 201 });
      },
      [`GET /api/shares/clip/${COPY}`]: () => Response.json(state("clip")),
      [`PUT /api/shares/clip/${COPY}/link`]: () => Response.json(state("clip", { link })),
    });
    await userEvent.click(await screen.findByRole("switch", { name: "Public link" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual([
        `POST /api/library/${ENTRY}/export`,
        `PUT /api/shares/clip/${COPY}/link`,
      ]);
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ clip: CLIP });
  });

  it("shares a clip running to the end, which the server ends at the file's end", async () => {
    let made = false;
    const calls = await open(
      {
        "GET /api/exports": () => Response.json(made ? [ended()] : []),
        [`POST /api/library/${ENTRY}/export`]: () => {
          made = true;
          return Response.json(ended(), { status: 201 });
        },
        [`GET /api/shares/clip/${COPY}`]: () => Response.json(state("clip")),
        [`PUT /api/shares/clip/${COPY}/link`]: () => Response.json(state("clip", { link })),
      },
      TO_END,
    );
    await userEvent.click(await screen.findByRole("switch", { name: "Public link" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual([
        `POST /api/library/${ENTRY}/export`,
        `PUT /api/shares/clip/${COPY}/link`,
      ]);
    });
  });

  it("finds that clip's copy, and its link, when the dialog opens again", async () => {
    const calls = await open(
      {
        "GET /api/exports": () => Response.json([ended({ state: "done" })]),
        [`GET /api/shares/clip/${COPY}`]: () => Response.json(state("clip", { link })),
      },
      TO_END,
    );
    expect(await screen.findByText("The clip is ready.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Public link" })).toBeChecked();
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shares nothing when the server answers a copy that isn't the clip (an older one)", async () => {
    const calls = await open({
      "GET /api/exports": () => Response.json([]),
      [`POST /api/library/${ENTRY}/export`]: () => Response.json(copy(null), { status: 201 }),
    });
    await userEvent.click(await screen.findByRole("switch", { name: "Public link" }));
    expect(await screen.findByText(/couldn't make the clip/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("shares the whole video opened at the clip: its link carries the range, its people hear of it", async () => {
    const calls = await open({
      "GET /api/exports": () => Response.json([]),
      [`PUT /api/shares/entry/${ENTRY}/people`]: () => Response.json(state("entry", { link })),
    });
    await userEvent.click(
      await screen.findByRole("radio", { name: /The whole video, opened at the clip/ }),
    );
    expect(await screen.findByLabelText("Link address")).toHaveValue(
      `${window.location.origin}/s/${CODE}?t=62.0&end=90.0`,
    );
    await userEvent.type(screen.getByLabelText("Add people or groups"), "bo");
    await userEvent.click(await screen.findByRole("button", { name: /Add Bob/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        people: [{ kind: "user", id: BOB }],
        expiresAt: null,
        clip: CLIP,
      });
    });
  });
});
