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

const MIB = 1024 * 1024;

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

  it("puts bytes, replacing what was there", async () => {
    await store.putBytes("seg/s1/seg-3.m4s", Buffer.from("first"), "video/mp4");
    await store.putBytes("seg/s1/seg-3.m4s", Buffer.from([0, 1, 2, 255]), "video/mp4");
    const opened = await store.open("seg/s1/seg-3.m4s");
    expect(opened.size).toBe(4);
    expect(Buffer.from(await new Response(opened.body).arrayBuffer())).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
  });

  it("gives the transcoder a URL to read on S3 (it has a path on the filesystem)", async () => {
    await store.put("read/f.txt", await source("readable"), "text/plain");
    const url = await store.readUrl("read/f.txt");
    if (kind === "filesystem") {
      expect(url).toBeNull();
    } else {
      expect(url).not.toBeNull();
      const res = await fetch(url ?? "");
      expect(await res.text()).toBe("readable");
      expect(new URL(url ?? "").searchParams.get("X-Amz-Expires")).toBe("21600");
    }
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

  describe("writing in parts", () => {
    // S3 refuses a part under 5 MiB unless it is the last one.
    const first = Buffer.alloc(5 * MIB, "a");
    const tail = Buffer.from("the end");
    const size = first.length + tail.length;

    async function bytesOf(key: string): Promise<Buffer> {
      return Buffer.from(await new Response((await store.open(key)).body).arrayBuffer());
    }

    it("assembles parts sent out of order, and completing twice is fine", async () => {
      const key = "up/parts/video.mp4";
      const id = await store.startUpload(key, "video/mp4");
      const two = await store.putPart(key, id, 2, first.length, tail);
      const one = await store.putPart(key, id, 1, 0, first);
      const parts = [
        { n: 1, ...one },
        { n: 2, ...two },
      ];
      expect(await store.completeUpload(key, id, parts, size)).toEqual({ size });
      expect(await store.completeUpload(key, id, parts, size)).toEqual({ size });
      expect(await store.stat(key)).toEqual({ size });
      expect(Buffer.compare(await bytesOf(key), Buffer.concat([first, tail]))).toBe(0);
    });

    it("refuses to complete with the wrong size, keeping the upload", async () => {
      const key = "up/short/video.mp4";
      const id = await store.startUpload(key, "video/mp4");
      const one = await store.putPart(key, id, 1, 0, first);
      await expect(store.completeUpload(key, id, [{ n: 1, ...one }], size)).rejects.toThrow();
      expect(await store.stat(key)).toBeNull();
      const two = await store.putPart(key, id, 2, first.length, tail);
      const parts = [
        { n: 1, ...one },
        { n: 2, ...two },
      ];
      expect(await store.completeUpload(key, id, parts, size)).toEqual({ size });
    });

    it("aborts an upload, and a part sent after it is refused", async () => {
      const key = "up/gone/video.mp4";
      const id = await store.startUpload(key, "video/mp4");
      await store.putPart(key, id, 1, 0, first);
      await store.abortUpload(key, id);
      await expect(store.putPart(key, id, 2, first.length, tail)).rejects.toThrow();
      expect(await store.stat(key)).toBeNull();
      await expect(store.abortUpload(key, id)).resolves.toBeUndefined();
      if (config.kind === "filesystem") {
        expect(await readdir(join(config.root, "up/gone")).catch(() => [])).toEqual([]);
      }
    });

    if (kind === "filesystem") {
      it("refuses an upload id that is not its own, and a key outside the root", async () => {
        const key = "up/odd/video.mp4";
        await store.startUpload(key, "video/mp4");
        await expect(store.putPart(key, "../../evil", 1, 0, tail)).rejects.toThrow();
        await expect(store.startUpload("../outside.mp4", "video/mp4")).rejects.toThrow();
      });
    }
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
