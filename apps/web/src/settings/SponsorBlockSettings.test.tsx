import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SPONSORBLOCK, DEFAULT_SPONSORBLOCK_COLORS } from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { SponsorBlockSettings } from "./SponsorBlockSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

const D = ["interaction", "selfpromo", "sponsor"];
const prefs = {
  hidePlaylistVideos: false,
  sponsorBlock: DEFAULT_SPONSORBLOCK,
  sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
};

describe("Settings › SponsorBlock", () => {
  it("lists the nine categories under Videos and under Audio, each with Show and Skip", async () => {
    fakeApi({ "GET /api/me/preferences": () => Response.json(prefs) });
    renderWithQuery(<SponsorBlockSettings />);
    for (const group of ["Videos", "Audio"]) {
      const section = await screen.findByRole("region", { name: group });
      for (const label of ["Sponsor", "Intro", "Hook or greeting", "Non-music section"]) {
        expect(within(section).getByRole("switch", { name: `${group}: show ${label}` }));
        expect(within(section).getByRole("switch", { name: `${group}: skip ${label}` }));
      }
      expect(within(section).getAllByRole("switch")).toHaveLength(18);
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

  it("shows each category's colour and the highlight's, SponsorBlock's until changed", async () => {
    fakeApi({ "GET /api/me/preferences": () => Response.json(prefs) });
    renderWithQuery(<SponsorBlockSettings />);
    const section = await screen.findByRole("region", { name: "Colours" });
    await waitFor(() => {
      expect(within(section).getByLabelText("Sponsor colour")).toHaveValue("#00d400");
    });
    expect(within(section).getByLabelText("Hook or greeting colour")).toHaveValue("#395699");
    expect(within(section).getByLabelText("Highlight colour")).toHaveValue("#ff1684");
    // Ten in all: nine categories and the highlight. Nothing to reset yet.
    expect(section.querySelectorAll('input[type="color"]')).toHaveLength(10);
    expect(
      within(section).queryByRole("button", { name: "Use SponsorBlock's colours" }),
    ).toBeNull();
  });

  it("saves a colour once the picking stops, not at every step", async () => {
    const calls = fakeApi({
      "GET /api/me/preferences": () => Response.json(prefs),
      "PATCH /api/me/preferences": (init) => {
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as object) : {};
        return Response.json({ ...prefs, ...body });
      },
    });
    renderWithQuery(<SponsorBlockSettings />);
    const sponsor = await screen.findByLabelText("Sponsor colour");
    await waitFor(() => {
      expect(sponsor).toBeEnabled();
    });
    for (const value of ["#110000", "#880000", "#ff0000"]) {
      fireEvent.change(sponsor, { target: { value } });
    }
    expect(sponsor).toHaveValue("#ff0000");
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      sponsorBlockColors: { ...DEFAULT_SPONSORBLOCK_COLORS, sponsor: "#ff0000" },
    });
    expect(screen.getByLabelText("Sponsor colour")).toHaveValue("#ff0000");
  });

  it("puts every colour back to SponsorBlock's", async () => {
    const changed = { ...DEFAULT_SPONSORBLOCK_COLORS, sponsor: "#123456" };
    const calls = fakeApi({
      "GET /api/me/preferences": () => Response.json({ ...prefs, sponsorBlockColors: changed }),
      "PATCH /api/me/preferences": () => Response.json(prefs),
    });
    renderWithQuery(<SponsorBlockSettings />);
    const reset = await screen.findByRole("button", { name: "Use SponsorBlock's colours" });
    expect(screen.getByLabelText("Sponsor colour")).toHaveValue("#123456");
    await userEvent.click(reset);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Sponsor colour")).toHaveValue("#00d400");
    });
    expect(screen.queryByRole("button", { name: "Use SponsorBlock's colours" })).toBeNull();
  });
});
