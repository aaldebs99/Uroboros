import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestS3 } from "../../test/testS3.ts";
import type { StorageConfig } from "./config.ts";
import { DEFAULT_LAYOUT } from "./config.ts";
import { createStore, type MediaStore } from "./index.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "uroboros-store-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function source(content: string): Promise<string> {
  const path = join(scratch, `src-${String(Math.random()).slice(2)}`);
  await writeFile(path, content);
  return path;
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

const backends: [string, () => Promise<StorageConfig>][] = [
  ["s3", () => TestS3.bucket()],
  [
    "filesystem",
    async () => ({
      kind: "filesystem",
      root: await mkdtemp(join(tmpdir(), "uroboros-media-")),
      layout: DEFAULT_LAYOUT,
    }),
  ],
];

describe.each(backends)("MediaStore (%s)", (kind, make) => {
  let config: StorageConfig;
  let store: MediaStore;
  beforeAll(async () => {
    config = await make();
    store = createStore(config);
  });

  it("puts a file, then reports its size", async () => {
    expect(await store.put("Chan/a b/one.mp4", await source("0123456789"), "video/mp4")).toEqual({
      size: 10,
    });
    expect(await store.stat("Chan/a b/one.mp4")).toEqual({ size: 10 });
  });

  it("opens the whole file, and a byte range (inclusive)", async () => {
    await store.put("x/two.bin", await source("0123456789"), "application/octet-stream");
    const whole = await store.open("x/two.bin");
    expect(whole.size).toBe(10);
    expect(await text(whole.body)).toBe("0123456789");
    const part = await store.open("x/two.bin", { start: 2, end: 5 });
    expect(part.size).toBe(10);
    expect(await text(part.body)).toBe("2345");
  });

  it("replaces a file put to an existing key", async () => {
    await store.put("x/three.txt", await source("old"), "text/plain");
    await store.put("x/three.txt", await source("newer"), "text/plain");
    expect(await text((await store.open("x/three.txt")).body)).toBe("newer");
  });

  it("deletes a file, and deleting a missing one is fine", async () => {
    await store.put("x/four.txt", await source("bye"), "text/plain");
    await store.delete("x/four.txt");
    expect(await store.stat("x/four.txt")).toBeNull();
    await expect(store.delete("x/never.txt")).resolves.toBeUndefined();
  });

  it("deletes everything under a prefix, and nothing beside it", async () => {
    await store.put("pre/a.txt", await source("a"), "text/plain");
    await store.put("pre/b/c.txt", await source("c"), "text/plain");
    await store.put("press/d.txt", await source("d"), "text/plain");
    await store.deletePrefix("pre/");
    expect(await store.stat("pre/a.txt")).toBeNull();
    expect(await store.stat("pre/b/c.txt")).toBeNull();
    expect(await store.stat("press/d.txt")).not.toBeNull();
    await store.deletePrefix("nothing-here/");
  });

  it("gives a local path only on the filesystem", async () => {
    await store.put("local/e.txt", await source("e"), "text/plain");
    const path = store.localPath("local/e.txt");
    if (kind === "filesystem") {
      expect(path).toMatch(/local\/e\.txt$/);
    } else {
      expect(path).toBeNull();
    }
  });

  it("has no download URL without a public endpoint", async () => {
    expect(await store.downloadUrl("x/two.bin", "two.bin")).toBeNull();
  });

  if (kind === "filesystem") {
    it("removes folders a delete leaves empty, never the root", async () => {
      const root = config.kind === "filesystem" ? config.root : "";
      await store.put("a/b/c.txt", await source("c"), "text/plain");
      await store.put("a/other.txt", await source("o"), "text/plain");
      await store.delete("a/b/c.txt");
      expect(await readdir(join(root, "a"))).toEqual(["other.txt"]);
      await store.delete("a/other.txt");
      expect(await readdir(root)).not.toContain("a");
      await store.delete("a/gone.txt");
      expect(await readdir(root)).toBeDefined();
    });

    it("leaves nothing behind when a put fails", async () => {
      await expect(
        store.put("y/five.txt", join(scratch, "missing"), "text/plain"),
      ).rejects.toThrow();
      const root = config.kind === "filesystem" ? config.root : "";
      const left = await readdir(join(root, "y")).catch(() => []);
      expect(left).toEqual([]);
    });
  }
});

describe("MediaStore (s3) with a public URL", () => {
  it("presigns download URLs against the public endpoint, with the file name", async () => {
    const config = await TestS3.bucket({ publicUrl: "https://media.example.org" });
    const url = new URL((await createStore(config).downloadUrl("k/v.mp4", "Bunny.mp4")) ?? "");
    expect(url.origin).toBe("https://media.example.org");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/Bunny\.mp4/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});
