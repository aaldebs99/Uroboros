import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("keeps a section's title for screen readers only, showing just the action", () => {
    render(<PageHeader title="Downloads" description="Queue." action={<button>Act</button>} />);
    const heading = screen.getByRole("heading", { name: "Downloads" });
    expect(heading.parentElement).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Act" }).parentElement).not.toHaveClass("sr-only");
  });

  it("hides the whole header when there is no action", () => {
    render(<PageHeader title="Settings" />);
    expect(screen.getByRole("heading", { name: "Settings" }).closest(".sr-only")).not.toBeNull();
  });

  it("shows the title of a page about one thing", () => {
    render(<PageHeader title="Road trip" showTitle />);
    expect(screen.getByRole("heading", { name: "Road trip" }).closest(".sr-only")).toBeNull();
  });
});
