import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { ProfilesPage } from "./ProfilesPage";

const admin = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Ada",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: true,
};
const p = (id: string, name: string, isDefault = false) => ({
  id: `0190a3f2-7c1e-7000-8000-0000000000${id}`,
  name,
  format: "b",
  mergeFormat: null,
  audioOnly: false,
  audioFormat: null,
  extraArgs: [],
  isDefault,
  revision: "r",
});
const seeds = [
  p("01", "Best up to 1080p (MP4)", true),
  p("02", "Best available"),
  p("03", "Audio only (Opus)"),
];

describe("ProfilesPage", () => {
  it("lists the profiles with the default marked and no Delete on it", async () => {
    fakeApi({ "GET /api/format-profiles": () => Response.json(seeds) });
    renderWithQuery(<ProfilesPage me={admin} />);
    const row = (await screen.findByText("Best up to 1080p (MP4)")).closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Default")).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("adds a profile, and shows the server's message when it refuses one", async () => {
    let refuse = true;
    const calls = fakeApi({
      "GET /api/format-profiles": () => Response.json(seeds),
      "POST /api/admin/format-profiles": () =>
        refuse
          ? Response.json(
              { code: "bad_request", message: "not an allowed flag: --exec" },
              { status: 400 },
            )
          : Response.json(p("04", "Small"), { status: 201 }),
    });
    renderWithQuery(<ProfilesPage me={admin} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add profile" }));
    await userEvent.type(screen.getByLabelText("Name"), "Small");
    await userEvent.type(screen.getByLabelText("Format selector"), "worst");
    await userEvent.type(screen.getByLabelText("Extra yt-dlp arguments"), "--exec x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("not an allowed flag: --exec")).toBeInTheDocument();
    refuse = false;
    await userEvent.clear(screen.getByLabelText("Extra yt-dlp arguments"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toMatchObject({
        name: "Small",
        format: "worst",
        extraArgs: [],
      });
    });
  });

  it("makes another profile the default", async () => {
    const calls = fakeApi({
      "GET /api/format-profiles": () => Response.json(seeds),
      [`PATCH /api/admin/format-profiles/${seeds[1]?.id ?? ""}`]: () =>
        Response.json({ ...seeds[1], isDefault: true }),
    });
    renderWithQuery(<ProfilesPage me={admin} />);
    const row = (await screen.findByText("Best available")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Make default" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ isDefault: true });
    });
  });

  it("tells a member only admins manage profiles", () => {
    renderWithQuery(<ProfilesPage me={{ ...admin, role: "member" }} />);
    expect(screen.getByText("Only admins can manage format profiles.")).toBeInTheDocument();
  });
});
