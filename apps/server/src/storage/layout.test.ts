import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "./config.ts";
import {
  renderLayout,
  renditionKey,
  sanitizeSegment,
  sidecarKey,
  type MediaNames,
} from "./layout.ts";

const bunny: MediaNames = {
  extractor: "Youtube",
  id: "aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  channel: "Blender",
  uploader: "Blender",
  uploadDate: "20080520",
  profile: "Best up to 1080p (MP4)",
  ext: "mp4",
};

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("sanitizeSegment", () => {
  it.each([
    "a/b",
    "..",
    ".",
    "...hidden",
    "\u0000x",
    "tab\there",
    "back\\slash",
    "",
    null,
    "x".repeat(400),
    "é".repeat(60),
    "   ",
    "😀".repeat(40),
  ])("makes %j a safe path segment", (value) => {
    const out = sanitizeSegment(value);
    expect(out).not.toMatch(/[/\\]/);
    expect(Array.from(out).some((c) => (c.codePointAt(0) ?? 0) < 0x20 || c === "\u007f")).toBe(
      false,
    );
    expect(out.startsWith(".")).toBe(false);
    expect(out).not.toBe("");
    expect(bytes(out)).toBeLessThanOrEqual(100);
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
    expect(out).not.toMatch(/�/);
  });

  it("keeps an ordinary title as it is", () => {
    expect(sanitizeSegment("Big Buck Bunny (4K)")).toBe("Big Buck Bunny (4K)");
  });
});

describe("renderLayout", () => {
  it("renders the default layout", () => {
    expect(renderLayout(DEFAULT_LAYOUT, bunny)).toBe(
      "Blender/2008-05-20 Big Buck Bunny [aqz-KE-bpKQ]/Big Buck Bunny [Best up to 1080p (MP4)].mp4",
    );
  });

  it("says unknown-date without an upload date, and falls back to the uploader", () => {
    expect(
      renderLayout("{channel}/{upload_date} {year} {title}.{ext}", {
        ...bunny,
        channel: null,
        uploader: "Someone",
        uploadDate: null,
      }),
    ).toBe("Someone/unknown-date unknown-year Big Buck Bunny.mp4");
  });

  it("keeps [id], [profile] and the extension however long the title is", () => {
    for (const title of ["x".repeat(400), "字".repeat(60), "😀".repeat(40)]) {
      const paths = new Set(
        [
          { ...bunny, title, id: "AAA" },
          { ...bunny, title, id: "BBB" },
          { ...bunny, title, id: "AAA", profile: "Best available" },
        ].map((n) => renderLayout(DEFAULT_LAYOUT, n)),
      );
      expect(paths.size).toBe(3);
      for (const p of paths) {
        expect(p).toMatch(/\.mp4$/);
        expect(p.split("/").every((seg) => Buffer.byteLength(seg) <= 100)).toBe(true);
        expect(p.split("/")[1]).toMatch(/\[(AAA|BBB)\]$/);
      }
    }
  });

  it("never leaves the root, whatever the metadata", () => {
    const root = "/media";
    for (const evil of ["../../etc", "/abs", "..", ".", "a/../../b", "\u0000"]) {
      const rel = renderLayout(DEFAULT_LAYOUT, { ...bunny, title: evil, channel: evil, id: evil });
      expect(resolve(root, rel).startsWith(root + sep)).toBe(true);
      expect(rel.split("/").every((s) => s !== "" && s !== "." && s !== "..")).toBe(true);
    }
  });
});

describe("keys", () => {
  it("uses opaque keys on S3", () => {
    const s3 = { kind: "s3" } as const;
    expect(renditionKey(s3, "m1", "p1", "r1", bunny)).toBe("media/m1/p1-r1.mp4");
    expect(sidecarKey(s3, "m1", bunny, "thumbnail", "jpg")).toBe("media/m1/thumbnail.jpg");
    expect(sidecarKey(s3, "m1", bunny, "info", "json")).toBe("media/m1/info.json");
  });

  it("puts sidecars beside the media file on a filesystem", () => {
    const fs = { kind: "filesystem", layout: DEFAULT_LAYOUT } as const;
    expect(renditionKey(fs, "m1", "p1", "r1", bunny)).toBe(renderLayout(DEFAULT_LAYOUT, bunny));
    expect(sidecarKey(fs, "m1", bunny, "thumbnail", "jpg")).toBe(
      "Blender/2008-05-20 Big Buck Bunny [aqz-KE-bpKQ]/Big Buck Bunny.jpg",
    );
    expect(sidecarKey(fs, "m1", bunny, "info", "json")).toBe(
      "Blender/2008-05-20 Big Buck Bunny [aqz-KE-bpKQ]/Big Buck Bunny.info.json",
    );
  });
});
