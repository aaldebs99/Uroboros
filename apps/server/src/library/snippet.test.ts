import { describe, expect, it } from "vitest";
import { snippet, startAt } from "./snippet.ts";

/** The snippet as text, each marked part in [brackets]. */
const shown = (s: ReturnType<typeof snippet>) =>
  s.parts.map((p) => (p.mark ? `[${p.text}]` : p.text)).join("");

describe("snippet", () => {
  it("marks every term, whatever its case, on one line", () => {
    const s = snippet("A story\n\nabout a  DRAGON and its dragon hoard", ["dragon", "hoard"]);
    expect(shown(s)).toBe("A story about a [DRAGON] and its [dragon] [hoard]");
    expect(s.anchor).toBe(16);
  });

  it("keeps 40 characters before the first match and 120 after, marking where it cut", () => {
    const before = "x".repeat(100);
    const after = "y ".repeat(100);
    const s = snippet(`${before} needle ${after}`, ["needle"]);
    const text = shown(s);
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text).toContain("[needle]");
    const [lead, rest] = text.slice(1, -1).split("[needle]");
    expect(lead?.length).toBeLessThanOrEqual(40);
    expect(rest?.length).toBeLessThanOrEqual(120);
  });

  it("merges overlapping matches into one mark", () => {
    expect(shown(snippet("the dragonfly flew", ["dragon", "dragonfly", "fly"]))).toBe(
      "the [dragonfly] flew",
    );
  });

  it("takes LIKE's wildcards and regular expression characters literally", () => {
    expect(shown(snippet("save 100% on (a.b) today", ["100%", "(a.b)"]))).toBe(
      "save [100%] on [(a.b)] today",
    );
  });

  it("shows the start of the text when no term is found there", () => {
    const s = snippet("nothing to see here", ["dragon"]);
    expect(shown(s)).toBe("nothing to see here");
    expect(s.anchor).toBeNull();
  });

  it("says the text went on when the database cut it", () => {
    expect(shown(snippet("a dragon", ["dragon"], { cutBefore: true, cutAfter: true }))).toBe(
      "…a [dragon]…",
    );
  });

  it("never cuts a character in half", () => {
    const s = snippet(`${"\u{1F409}".repeat(30)} dragon`, ["dragon"]);
    for (const p of s.parts) expect(p.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("startAt", () => {
  it("is when the caption line holding the match starts", () => {
    const lineAt = [0, 12, 30];
    const lineStart = [1, 2.5, 4];
    expect(startAt(0, lineAt, lineStart)).toBe(1);
    expect(startAt(15, lineAt, lineStart)).toBe(2.5);
    expect(startAt(30, lineAt, lineStart)).toBe(4);
    expect(startAt(null, lineAt, lineStart)).toBe(1);
  });
});
