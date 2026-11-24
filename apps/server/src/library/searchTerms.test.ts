import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors.ts";
import { likePattern, searchTerms } from "./searchTerms.ts";

const refused = (q: string) => {
  try {
    searchTerms(q);
  } catch (err) {
    return err instanceof ApiError && err.code === "bad_request" ? err.message : String(err);
  }
  return "accepted";
};

describe("searchTerms", () => {
  it("is no search for nothing but spaces", () => {
    expect(searchTerms("")).toBeNull();
    expect(searchTerms("   ")).toBeNull();
  });

  it("splits words, keeps quoted phrases whole, and takes OR and -word literally", () => {
    expect(searchTerms("  big   buck bunny ")).toEqual(["big", "buck", "bunny"]);
    expect(searchTerms('"big  buck" bunny')).toEqual(["big buck", "bunny"]);
    expect(searchTerms('dragon "their hoards')).toEqual(["dragon", "their hoards"]);
    expect(searchTerms("cats OR -dogs")).toEqual(["cats", "OR", "-dogs"]);
    expect(searchTerms('say"hello"')).toEqual(["say", "hello"]);
  });

  it("drops repeated words, whatever their case", () => {
    expect(searchTerms("Dragon dragon DRAGON egg")).toEqual(["Dragon", "egg"]);
    expect(searchTerms('"" dragon')).toEqual(["dragon"]);
  });

  it("refuses what the index cannot search, or too much", () => {
    expect(refused("ab")).toMatch(/at least 3 characters/);
    expect(refused("a b")).toMatch(/3 letters or digits/);
    expect(refused("!!!")).toMatch(/3 letters or digits/);
    expect(refused("x".repeat(201))).toMatch(/at most 200 characters/);
    expect(refused("one two three four five six seven eight nine")).toMatch(/at most 8/);
    // A short word beside a long one is fine; so are 200 characters and 8 words.
    expect(refused("ai dragon")).toBe("accepted");
    expect(refused("x".repeat(200))).toBe("accepted");
    expect(refused("one two three four five six seven eight")).toBe("accepted");
    // Characters, not UTF-16 units: three dragons are three characters.
    expect(refused("\u{1F409}\u{1F409}")).toMatch(/at least 3 characters/);
    expect(refused("日本語")).toBe("accepted");
  });
});

describe("likePattern", () => {
  it("matches the term anywhere, with LIKE's wildcards taken literally", () => {
    expect(likePattern("big buck")).toBe("%big buck%");
    expect(likePattern("100%_off\\now")).toBe("%100\\%\\_off\\\\now%");
  });
});
