import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { DEFAULT_LAYOUT } from "./config.ts";
import { createStore, type MediaStore } from "./index.ts";
import { measureFileSizes } from "./measure.ts";

let t: TestDb;
let store: MediaStore;
let dir: string;

beforeAll(async () => {
  t = await TestDb.create();
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-measure-")),
    layout: DEFAULT_LAYOUT,
  });
  dir = await mkdtemp(join(tmpdir(), "uroboros-measure-src-"));
});
afterAll(async () => {
  await t.close();
});

/** Stores `bytes` bytes under `key`. */
async function file(key: string, bytes: number): Promise<string> {
  const path = join(dir, randomUUID());
  await writeFile(path, "x".repeat(bytes));
  await store.put(key, path, "application/octet-stream");
  return key;
}

/** A media row whose thumbnail, info file and preview are stored, none of them measured. */
async function media(sizes: { thumbnail?: number; info?: number; preview?: number } = {}) {
  const id = randomUUID();
  const at = (name: string, bytes: number | undefined) =>
    bytes === undefined ? Promise.resolve(null) : file(`media/${id}/${name}`, bytes);
  await t.db
    .insertInto("media")
    .values({
      id,
      extractor: "youtube",
      video_id: id,
      thumbnail_key: await at("thumb.jpg", sizes.thumbnail),
      info_key: await at("info.json", sizes.info),
      preview_key: await at("preview.mp4", sizes.preview),
    })
    .execute();
  return id;
}

const sizesOf = (id: string) =>
  t.db
    .selectFrom("media")
    .select(["thumbnail_bytes", "info_bytes", "preview_bytes"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("measureFileSizes", () => {
  it("records the size of every stored file that has none, subtitles included", async () => {
    const id = await media({ thumbnail: 7, info: 11, preview: 13 });
    const sub = await t.db
      .insertInto("subtitles")
      .values({ media_id: id, lang: "en", storage_key: await file(`media/${id}/en.vtt`, 3) })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(await measureFileSizes(t.db, store)).toBeGreaterThanOrEqual(4);
    expect(await sizesOf(id)).toEqual({
      thumbnail_bytes: "7",
      info_bytes: "11",
      preview_bytes: "13",
    });
    const subtitle = await t.db
      .selectFrom("subtitles")
      .select("size_bytes")
      .where("id", "=", sub.id)
      .executeTakeFirstOrThrow();
    expect(subtitle.size_bytes).toBe("3");
    // Nothing left: the next pass measures none.
    expect(await measureFileSizes(t.db, store)).toBe(0);
  });

  it("counts a file the store no longer has as 0 bytes, so it is not asked about again", async () => {
    const id = randomUUID();
    await t.db
      .insertInto("media")
      .values({ id, extractor: "youtube", video_id: id, thumbnail_key: `gone/${id}.jpg` })
      .execute();
    await measureFileSizes(t.db, store);
    expect((await sizesOf(id)).thumbnail_bytes).toBe("0");
  });

  it("measures at most a batch a pass", async () => {
    await measureFileSizes(t.db, store);
    const ids = [await media({ thumbnail: 1 }), await media({ thumbnail: 2 })];
    expect(await measureFileSizes(t.db, store, 1)).toBe(1);
    expect(await measureFileSizes(t.db, store, 5)).toBe(1);
    for (const id of ids) expect((await sizesOf(id)).thumbnail_bytes).not.toBeNull();
  });

  it("leaves a file whose key changed while it was measured to the next pass", async () => {
    await measureFileSizes(t.db, store);
    const id = await media({ thumbnail: 5 });
    const next = await file(`media/${id}/thumb-2.jpg`, 9);
    // The person replaces the thumbnail while the old one is being measured.
    const racing: MediaStore = {
      ...store,
      stat: async (key) => {
        await t.db.updateTable("media").set({ thumbnail_key: next }).where("id", "=", id).execute();
        return store.stat(key);
      },
    };
    await measureFileSizes(t.db, racing);
    expect((await sizesOf(id)).thumbnail_bytes).toBeNull();
    await measureFileSizes(t.db, store);
    expect((await sizesOf(id)).thumbnail_bytes).toBe("9");
  });
});

describe("a stored file's size goes with its key (the migration's trigger)", () => {
  it("is forgotten when the key changes without a new size, and kept when one comes with it", async () => {
    const id = await media();
    await t.db
      .updateTable("media")
      .set({ thumbnail_key: "a.jpg", thumbnail_bytes: 100, info_key: "a.json", info_bytes: 5 })
      .where("id", "=", id)
      .execute();
    expect(await sizesOf(id)).toMatchObject({ thumbnail_bytes: "100", info_bytes: "5" });
    // The release before replaces a thumbnail knowing nothing of sizes.
    await t.db.updateTable("media").set({ thumbnail_key: "b.jpg" }).where("id", "=", id).execute();
    expect(await sizesOf(id)).toMatchObject({ thumbnail_bytes: null, info_bytes: "5" });
    await t.db
      .updateTable("media")
      .set({ thumbnail_key: "c.jpg", thumbnail_bytes: 42 })
      .where("id", "=", id)
      .execute();
    expect((await sizesOf(id)).thumbnail_bytes).toBe("42");
    // Anything else changing leaves the sizes be.
    await t.db.updateTable("media").set({ title: "Renamed" }).where("id", "=", id).execute();
    expect(await sizesOf(id)).toMatchObject({ thumbnail_bytes: "42", info_bytes: "5" });
  });

  it("does the same for a subtitle file", async () => {
    const id = await media();
    const sub = await t.db
      .insertInto("subtitles")
      .values({ media_id: id, lang: "fr", storage_key: "fr.vtt", size_bytes: 8 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const size = async () =>
      (
        await t.db
          .selectFrom("subtitles")
          .select("size_bytes")
          .where("id", "=", sub.id)
          .executeTakeFirstOrThrow()
      ).size_bytes;
    await t.db
      .updateTable("subtitles")
      .set({ indexed_at: new Date() })
      .where("id", "=", sub.id)
      .execute();
    expect(await size()).toBe("8");
    await t.db
      .updateTable("subtitles")
      .set({ storage_key: "fr-2.vtt" })
      .where("id", "=", sub.id)
      .execute();
    expect(await size()).toBeNull();
  });
});
