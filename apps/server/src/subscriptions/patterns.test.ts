import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { ApiError } from "../api/errors.ts";
import { checkPattern, normalizePattern, PatternTimeout, titlesPass } from "./patterns.ts";

let t: TestDb;
beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

describe("title patterns", () => {
  it("rewrites \\b to \\y outside brackets", () => {
    expect(normalizePattern("\\blive\\b")).toBe("\\ylive\\y");
    expect(normalizePattern("\\Bx")).toBe("\\Yx");
    expect(normalizePattern("[\\b]")).toBe("[\\b]");
    expect(normalizePattern("[]\\b]\\b")).toBe("[]\\b]\\y");
    expect(normalizePattern("\\\\b")).toBe("\\\\b");
    expect(normalizePattern("a\\d+")).toBe("a\\d+");
  });

  it("refuses an invalid pattern", async () => {
    await expect(checkPattern(t.db, "((")).rejects.toBeInstanceOf(ApiError);
    await expect(checkPattern(t.db, "\\ylive\\y")).resolves.toBeUndefined();
  });

  it("matches titles case-insensitively, include and exclude", async () => {
    expect(await titlesPass(t.db, ["Live Q&A", "Tutorial", null], null, "\\ylive\\y")).toEqual([
      false,
      true,
      true,
    ]);
    expect(await titlesPass(t.db, ["Live Q&A", "Tutorial"], "tutorial|q&a", null)).toEqual([
      true,
      true,
    ]);
    expect(await titlesPass(t.db, ["Podcast 12", "Clip"], "podcast", "clip")).toEqual([
      true,
      false,
    ]);
    // A missing title matches nothing an include asks for.
    expect(await titlesPass(t.db, [null], "x", null)).toEqual([false]);
    expect(await titlesPass(t.db, ["a", "b"], null, null)).toEqual([true, true]);
  });

  it("throws PatternTimeout when the statement times out", async () => {
    const titles = Array.from({ length: 200_000 }, (_, i) => `title number ${String(i)} aaaa`);
    await expect(titlesPass(t.db, titles, "(a|aa)+b", null, 1)).rejects.toBeInstanceOf(
      PatternTimeout,
    );
  });
});
