import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LinkifiedText } from "./LinkifiedText";

const links = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"));

describe("LinkifiedText", () => {
  it("makes each http(s) URL a link that opens in a new tab, keeping the text between", () => {
    const { container } = render(
      <p>
        <LinkifiedText text={"Merch: https://shop.example/a?b=1\nSite http://x.example end"} />
      </p>,
    );
    expect(links()).toEqual(["https://shop.example/a?b=1", "http://x.example"]);
    expect(container.textContent).toBe(
      "Merch: https://shop.example/a?b=1\nSite http://x.example end",
    );
    const first = screen.getAllByRole("link")[0];
    expect(first).toHaveAttribute("target", "_blank");
    expect(first).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("leaves the punctuation ending a sentence, and an unopened parenthesis, outside the link", () => {
    render(
      <LinkifiedText
        text={
          "See https://a.example/x. Or (https://b.example/y) and https://en.wikipedia.org/wiki/Foo_(bar)!"
        }
      />,
    );
    expect(links()).toEqual([
      "https://a.example/x",
      "https://b.example/y",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  it("links nothing that isn't an http(s) URL", () => {
    render(<LinkifiedText text="javascript:alert(1) www.example.com mailto:a@b.c https://" />);
    expect(links()).toEqual([]);
  });
});
