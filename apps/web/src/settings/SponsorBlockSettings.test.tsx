import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SPONSORBLOCK } from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { SponsorBlockSettings } from "./SponsorBlockSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

const D = ["interaction", "selfpromo", "sponsor"];
const prefs = { hidePlaylistVideos: false, sponsorBlock: DEFAULT_SPONSORBLOCK };

describe("Settings › SponsorBlock", () => {
  it("lists the eight categories under Videos and under Audio, each with Show and Skip", async () => {
    fakeApi({ "GET /api/me/preferences": () => Response.json(prefs) });
    renderWithQuery(<SponsorBlockSettings />);
    for (const group of ["Videos", "Audio"]) {
      const section = await screen.findByRole("region", { name: group });
      for (const label of ["Sponsor", "Intro", "Non-music section"]) {
        expect(within(section).getByRole("switch", { name: `${group}: show ${label}` }));
        expect(within(section).getByRole("switch", { name: `${group}: skip ${label}` }));
      }
      expect(within(section).getAllByRole("switch")).toHaveLength(16);
    }
  });

  it("shows the defaults: sponsor, self-promotion and interaction reminders, shown and skipped", async () => {
    fakeApi({ "GET /api/me/preferences": () => Response.json(prefs) });
    renderWithQuery(<SponsorBlockSettings />);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Videos: skip Sponsor" })).toBeChecked();
    });
    expect(screen.getByRole("switch", { name: "Audio: show Self-promotion" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Videos: show Interaction reminder" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Videos: skip Intro" })).not.toBeChecked();
  });

  it("turning Skip off for Videos › Sponsor patches only sponsorBlock", async () => {
    const calls = fakeApi({
      "GET /api/me/preferences": () => Response.json(prefs),
      "PATCH /api/me/preferences": () =>
        Response.json({
          ...prefs,
          sponsorBlock: {
            ...DEFAULT_SPONSORBLOCK,
            video: { show: D, skip: ["interaction", "selfpromo"] },
          },
        }),
    });
    renderWithQuery(<SponsorBlockSettings />);
    const sponsor = await screen.findByRole("switch", { name: "Videos: skip Sponsor" });
    await waitFor(() => {
      expect(sponsor).toBeEnabled();
    });
    await userEvent.click(sponsor);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        sponsorBlock: {
          video: { show: D, skip: ["interaction", "selfpromo"] },
          audio: { show: D, skip: D },
        },
      });
    });
    expect(screen.getByRole("switch", { name: "Videos: skip Sponsor" })).not.toBeChecked();
  });

  it("puts a switch back when the save fails", async () => {
    const calls = fakeApi({
      "GET /api/me/preferences": () => Response.json(prefs),
      "PATCH /api/me/preferences": () =>
        Response.json({ code: "internal", message: "boom" }, { status: 500 }),
    });
    renderWithQuery(<SponsorBlockSettings />);
    const audioIntro = await screen.findByRole("switch", { name: "Audio: show Intro" });
    await waitFor(() => {
      expect(audioIntro).toBeEnabled();
    });
    await userEvent.click(audioIntro);
    // The switch turned on at once (the patch went out with it on), and back off when it failed.
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
        sponsorBlock: { audio: { show: ["interaction", "intro", "selfpromo", "sponsor"] } },
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Audio: show Intro" })).not.toBeChecked();
    });
  });

  it("sends quick toggles one at a time, so the last click is what the server keeps", async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let patches = 0;
    const calls = fakeApi({
      "GET /api/me/preferences": () => Response.json(prefs),
      "PATCH /api/me/preferences": async (init) => {
        patches += 1;
        if (patches === 1) await first;
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as object) : {};
        return Response.json({ ...prefs, ...body });
      },
    });
    renderWithQuery(<SponsorBlockSettings />);
    const intro = await screen.findByRole("switch", { name: "Videos: show Intro" });
    await waitFor(() => {
      expect(intro).toBeEnabled();
    });
    await userEvent.click(intro);
    await userEvent.click(screen.getByRole("switch", { name: "Videos: skip Intro" }));
    // The second waits for the first to be answered.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    release?.();
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toMatchObject({
      sponsorBlock: { video: { show: ["interaction", "intro", "selfpromo", "sponsor"] } },
    });
  });
});
