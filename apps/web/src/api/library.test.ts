import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { retryLibrary } from "./library";

describe("retryLibrary", () => {
  it("never asks again for a search the server refused or cut short", () => {
    const search = retryLibrary({ q: "dragon" });
    expect(search(0, new ApiError(400, "search for at least 3 characters"))).toBe(false);
    expect(search(0, new ApiError(503, "the search took too long"))).toBe(false);
    // A failure the next try may not meet is tried once more, as everywhere else.
    expect(search(0, new ApiError(500, "boom"))).toBe(true);
    expect(search(0, new TypeError("network"))).toBe(true);
    expect(search(1, new TypeError("network"))).toBe(false);
    // Without a search, a 503 (the database still starting) is worth one more try.
    expect(retryLibrary({})(0, new ApiError(503, "starting"))).toBe(true);
  });
});
