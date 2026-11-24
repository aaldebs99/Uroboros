import { describe, expect, it } from "vitest";
import { checkDeleted } from "./s3.ts";

describe("checkDeleted", () => {
  it("passes a batch S3 deleted in full", () => {
    expect(() => {
      checkDeleted({});
    }).not.toThrow();
    expect(() => {
      checkDeleted({ Errors: [] });
    }).not.toThrow();
  });

  it("throws on keys S3 failed to delete, so the trash keeps the prefix for the next pass", () => {
    expect(() => {
      checkDeleted({
        Errors: [
          { Key: ".transcodes/a/seg-1.m4s", Code: "AccessDenied" },
          { Key: ".transcodes/a/seg-2.m4s", Code: "InternalError" },
        ],
      });
    }).toThrow(/could not delete 2 keys.*\.transcodes\/a\/seg-1\.m4s \(AccessDenied\)/);
  });
});
