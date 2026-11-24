import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { itemFixture } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { Suggestions } from "./Suggestions";

describe("Suggestions", () => {
  it("lists one video per row, its thumbnail growing with the row beside the title", async () => {
    const others = ["Sintel", "Spring", "Charge"].map((title, i) => ({
      ...itemFixture,
      id: `0190a3f2-7c1e-7000-8000-0000000000d${String(i)}`,
      title,
    }));
    fakeApi({
      "GET /api/library": () =>
        Response.json({ entries: [itemFixture, ...others], nextCursor: null }),
    });
    await renderInRouter(<Suggestions currentId={itemFixture.id} />);
    const list = await screen.findByRole("list");
    // A single column: no auto-filled columns side by side.
    expect(list.className).not.toMatch(/grid-cols/);
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const link = within(rows[0] as HTMLElement).getByRole("link", { name: /Sintel/ });
    const thumbnail = link.firstElementChild;
    expect(thumbnail).toHaveClass("w-[40%]", "min-w-42");
    expect(thumbnail?.nextElementSibling).toHaveClass("flex-1");
  });
});
