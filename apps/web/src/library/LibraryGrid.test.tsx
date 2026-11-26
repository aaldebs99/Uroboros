import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { LibraryGrid } from "./LibraryGrid";

describe("LibraryGrid", () => {
  it("says why a search was refused, at once, without asking again", async () => {
    const calls = fakeApi({
      "GET /api/library": () =>
        Response.json({ code: "bad_request", message: "that search is too long" }, { status: 400 }),
    });
    await renderInRouter(<LibraryGrid filters={{ q: "dragons" }} empty={<p>nothing</p>} />);
    expect(await screen.findByText("that search is too long")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/api/library")).toHaveLength(1);
    expect(screen.queryByText("nothing")).not.toBeInTheDocument();
  });

  it("asks once more before it shows a failed listing", async () => {
    const calls = fakeApi({
      "GET /api/library": () =>
        Response.json({ code: "internal", message: "boom" }, { status: 500 }),
    });
    await renderInRouter(<LibraryGrid filters={{}} empty={<p>nothing</p>} />);
    // After one retry, a second later by TanStack's default.
    expect(await screen.findByRole("paragraph")).toHaveClass("text-destructive");
    expect(calls.filter((c) => c.path === "/api/library")).toHaveLength(2);
  });
});
