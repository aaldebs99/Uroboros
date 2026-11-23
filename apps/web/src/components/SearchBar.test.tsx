import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderInRouter } from "@/test/render";

import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("searches the library with what was typed", async () => {
    const onSearch = vi.fn();
    await renderInRouter(<SearchBar onSearch={onSearch} />);
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search your library" }),
      "big buck{Enter}",
    );
    expect(onSearch).toHaveBeenCalledWith("big buck");
  });
});
