import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComboboxField, rankOptions } from "./combobox-field";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

const SITES = ["avimeo", "twitch", "vimeo", "vk"];

function Harness({
  onSubmit = () => undefined,
  free = false,
}: {
  onSubmit?: () => void;
  free?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ComboboxField
        label="Site"
        options={SITES}
        value={value}
        onChange={setValue}
        free={free}
        maxLength={12}
      />
      <output aria-label="Picked">{value}</output>
      <button type="submit">Save</button>
    </form>
  );
}

const options = () =>
  within(screen.getByRole("listbox", { name: "Site" }))
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("rankOptions", () => {
  it("keeps the options holding the text, those starting with it first, in any case", () => {
    expect(rankOptions(SITES, "VI")).toEqual(["vimeo", "avimeo"]);
    expect(rankOptions(SITES, "  ")).toEqual(SITES);
    expect(rankOptions(SITES, "zzz")).toEqual([]);
  });
});

describe("ComboboxField", () => {
  it("filters as you type, and Enter picks the first match without submitting", async () => {
    const submitted = vi.fn();
    render(<Harness onSubmit={submitted} />);
    const input = screen.getByRole("combobox", { name: "Site" });
    await userEvent.type(input, "vi");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(options()).toEqual(["vimeo", "avimeo"]);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("Picked")).toHaveTextContent("vimeo");
    expect(input).toHaveValue("vimeo");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(submitted).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and picks with a click", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Site" });
    await userEvent.click(input);
    expect(options()).toEqual(SITES);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-2$/);
    await userEvent.click(screen.getByRole("option", { name: "twitch" }));
    expect(screen.getByLabelText("Picked")).toHaveTextContent("twitch");
  });

  it("says when nothing matches, and drops unmatched text on leaving the field", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Site" });
    await userEvent.type(input, "zzz");
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    await userEvent.tab();
    expect(input).toHaveValue("");
    expect(screen.getByLabelText("Picked")).toBeEmptyDOMElement();
  });

  it("closes its list on Escape and leaves the dialog around it open", async () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Add a login</DialogTitle>
          <Harness />
        </DialogContent>
      </Dialog>,
    );
    const input = screen.getByRole("combobox", { name: "Site" });
    await userEvent.type(input, "tw");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("dialog", { name: "Add a login" })).toBeInTheDocument();
  });

  it("keeps typed text that matches nothing when free, suggests what it holds, and Enter submits", async () => {
    const submitted = vi.fn();
    render(<Harness onSubmit={submitted} free />);
    const input = screen.getByRole("combobox", { name: "Site" });
    expect(input).toHaveAttribute("maxlength", "12");
    await userEvent.type(input, "vi");
    expect(options()).toEqual(["vimeo", "avimeo"]);
    expect(screen.getByLabelText("Picked")).toHaveTextContent("vi");
    await userEvent.type(input, "deos");
    // Nothing suggested: the list is closed.
    expect(input).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    expect(submitted).toHaveBeenCalledOnce();
    await userEvent.tab();
    expect(input).toHaveValue("videos");
    expect(screen.getByLabelText("Picked")).toHaveTextContent("videos");
  });

  it("picks a suggestion with the arrow keys and Enter when free", async () => {
    const submitted = vi.fn();
    render(<Harness onSubmit={submitted} free />);
    await userEvent.type(screen.getByRole("combobox", { name: "Site" }), "vi");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByLabelText("Picked")).toHaveTextContent("vimeo");
    expect(submitted).not.toHaveBeenCalled();
  });
});
