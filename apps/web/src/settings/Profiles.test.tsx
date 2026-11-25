import type { FormatProfile } from "@uroboros/contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { FormatProfiles } from "./Profiles";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;

const profile = (n: number, name: string, over: Partial<FormatProfile> = {}): FormatProfile => ({
  id: id(n),
  name,
  format: "bv*+ba/b",
  mergeFormat: null,
  audioOnly: false,
  audioFormat: null,
  extraArgs: [],
  builtIn: true,
  isDefault: false,
  revision: "r",
  ...over,
});

const BEST = profile(1, "Best available", { isDefault: true });
const AUDIO = profile(2, "Audio only (Opus)", { audioOnly: true, audioFormat: "opus" });
const MINE = profile(3, "Mine 720p", { builtIn: false, format: "b[height<=720]" });

afterEach(() => {
  vi.unstubAllGlobals();
});

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);

describe("FormatProfiles", () => {
  it("lists every profile, built-in ones marked, each to copy, edit or delete", async () => {
    fakeApi({ "GET /api/format-profiles": () => Response.json([BEST, AUDIO, MINE]) });
    renderWithQuery(<FormatProfiles />);
    const list = await screen.findByRole("list", { name: "Your profiles" });
    expect(names(list)).toEqual([
      "Best availableDefaultBuilt-in",
      "Audio only (Opus)Built-in",
      "Mine 720p",
    ]);
    for (const p of [BEST, AUDIO, MINE]) {
      for (const action of ["Copy", "Edit", "Delete"]) {
        expect(within(list).getByRole("button", { name: `${action} ${p.name}` })).toBeEnabled();
      }
    }
  });

  it("copies a profile under a new name into one of the person's own", async () => {
    const calls = fakeApi({
      "GET /api/format-profiles": () => Response.json([BEST, AUDIO]),
      "POST /api/format-profiles": () =>
        Response.json(profile(4, "Best available (copy)", { builtIn: false }), { status: 201 }),
    });
    renderWithQuery(<FormatProfiles />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy Best available" }));
    const dialog = screen.getByRole("dialog", { name: "Copy Best available" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Best available (copy)");
    // SponsorBlock is each person's setting now, never a profile's.
    expect(within(dialog).queryByRole("group", { name: /SponsorBlock/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const posted = calls.find((c) => c.method === "POST")?.body as Record<string, unknown>;
    expect(posted).toMatchObject({ name: "Best available (copy)", format: "bv*+ba/b" });
    expect(posted).not.toHaveProperty("sponsorblockRemove");
  });

  it("edits a built-in like any other (the server makes it the person's own)", async () => {
    const calls = fakeApi({
      "GET /api/format-profiles": () => Response.json([BEST, AUDIO]),
      [`PATCH /api/format-profiles/${BEST.id}`]: () =>
        Response.json(profile(5, "Best available", { builtIn: false, isDefault: true })),
    });
    renderWithQuery(<FormatProfiles />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Best available" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Best available" });
    const format = within(dialog).getByLabelText(/^Format/);
    await userEvent.clear(format);
    // Pasted: typing reads "[" as a key name.
    await userEvent.paste("b[height<=480]");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
        format: "b[height<=480]",
      });
    });
  });

  it("makes a profile the person's default, and deletes one after saying whose it is", async () => {
    const calls = fakeApi({
      "GET /api/format-profiles": () => Response.json([BEST, AUDIO, MINE]),
      "PUT /api/format-profiles/default": () => new Response(null, { status: 204 }),
      [`DELETE /api/format-profiles/${AUDIO.id}`]: () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<FormatProfiles />);
    expect(
      await screen.findByRole("button", { name: "Make Audio only (Opus) your default" }),
    ).toBeInTheDocument();
    // The default has no Make default of its own.
    expect(screen.queryByRole("button", { name: "Make Best available your default" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Make Mine 720p your default" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ profileId: MINE.id });
    });

    await userEvent.click(screen.getByRole("button", { name: "Delete Audio only (Opus)" }));
    const confirm = screen.getByRole("alertdialog", {
      name: 'Delete the profile "Audio only (Opus)"?',
    });
    expect(within(confirm).getByText(/everyone else keeps it/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });
});
