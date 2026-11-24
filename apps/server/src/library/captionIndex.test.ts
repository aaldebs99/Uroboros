import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import type { MediaStore } from "../storage/store.ts";
import {
  indexMediaCaptions,
  indexPendingCaptions,
  MAX_CAPTION_BYTES,
  pickCaptionTracks,
  storeReader,
} from "./captionIndex.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let userId: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  userId = (await signedIn(testDb.db, { username: "capidx" })).userId;
});
afterAll(async () => {
  await testDb.close();
});

const ctx = () => ({ db: testDb.db, logger });

const track = (lang: string, automatic: boolean, index_failures = 0) => ({
  id: `${lang}-${String(automatic)}`,
  lang,
  automatic,
  index_failures,
  storage_key: `subs/${lang}-${String(automatic)}.vtt`,
});
const langs = (rows: { lang: string; automatic: boolean }[]) =>
  rows.map((r) => `${r.lang}${r.automatic ? " (auto)" : ""}`);

describe("pickCaptionTracks", () => {
  it("takes one track per language: manual, then the original, then the plain code", () => {
    expect(langs(pickCaptionTracks([track("en", true), track("en", false)]))).toEqual(["en"]);
    expect(langs(pickCaptionTracks([track("en", true), track("en-orig", true)]))).toEqual([
      "en-orig (auto)",
    ]);
    expect(langs(pickCaptionTracks([track("en-de", true), track("en", true)]))).toEqual([
      "en (auto)",
    ]);
    expect(langs(pickCaptionTracks([track("en-US", false), track("en", false)]))).toEqual(["en"]);
  });

  it("takes at most 3 languages, those with manual tracks first", () => {
    const picked = pickCaptionTracks([
      track("de", true),
      track("fr", false),
      track("en", true),
      track("es", true),
    ]);
    expect(langs(picked)).toEqual(["fr", "de (auto)", "en (auto)"]);
  });

  it("passes over a track that failed to read 3 times", () => {
    expect(langs(pickCaptionTracks([track("en", false, 3), track("en", true, 2)]))).toEqual([
      "en (auto)",
    ]);
  });
});

/** A media of someone's with subtitle rows for `tracks` (lang → automatic). */
async function mediaWith(tracks: [string, boolean][]) {
  const { mediaId } = await seedEntry(testDb.db, userId, { title: randomUUID() });
  const subs = [];
  for (const [lang, automatic] of tracks) {
    subs.push(
      await testDb.db
        .insertInto("subtitles")
        .values({
          media_id: mediaId,
          lang,
          automatic,
          storage_key: `media/${mediaId}/subs/${lang}-${String(automatic)}.vtt`,
        })
        .returning(["id", "storage_key"])
        .executeTakeFirstOrThrow(),
    );
  }
  return { mediaId, subs };
}

const cue = (start: string, end: string, text: string) => `${start} --> ${end}\n${text}\n`;
const vtt = (...cues: string[]) => `WEBVTT\n\n${cues.join("\n")}`;

const segmentsOf = (mediaId: string) =>
  testDb.db
    .selectFrom("caption_segments")
    .select(["subtitle_id", "seq", "start_s", "end_s", "text", "line_at", "line_start"])
    .where("media_id", "=", mediaId)
    .orderBy("subtitle_id")
    .orderBy("seq")
    .execute();
const subtitleState = (mediaId: string) =>
  testDb.db
    .selectFrom("subtitles")
    .select(["lang", "automatic", "indexed_at", "index_failures"])
    .where("media_id", "=", mediaId)
    .orderBy("lang")
    .orderBy("automatic")
    .execute();

describe("indexMediaCaptions", () => {
  it("stores the picked track's segments and marks every track indexed", async () => {
    const { mediaId, subs } = await mediaWith([
      ["en", false],
      ["en", true],
    ]);
    const files = new Map([
      [
        subs[0]?.storage_key,
        vtt(
          cue("00:00:01.000", "00:00:02.000", "hello there"),
          cue("00:00:02.000", "00:00:03.500", "general dragon"),
          cue("00:01:00.000", "00:01:02.000", "much later"),
        ),
      ],
      [subs[1]?.storage_key, vtt(cue("00:00:01.000", "00:00:02.000", "auto words"))],
    ]);
    const read = (key: string) => Promise.resolve(files.get(key) ?? "");
    expect(await indexMediaCaptions(ctx(), mediaId, read)).toBe("indexed");
    expect(await segmentsOf(mediaId)).toEqual([
      {
        subtitle_id: subs[0]?.id,
        seq: 0,
        start_s: 1,
        end_s: 3.5,
        text: "hello there general dragon",
        line_at: [0, 12],
        line_start: [1, 2],
      },
      {
        subtitle_id: subs[0]?.id,
        seq: 1,
        start_s: 60,
        end_s: 62,
        text: "much later",
        line_at: [0],
        line_start: [60],
      },
    ]);
    const state = await subtitleState(mediaId);
    expect(state.every((s) => s.indexed_at !== null && s.index_failures === 0)).toBe(true);
  });

  it("replaces a media's segments when it indexes again", async () => {
    const { mediaId } = await mediaWith([["en", false]]);
    await indexMediaCaptions(ctx(), mediaId, () =>
      Promise.resolve(vtt(cue("00:00:01.000", "00:00:02.000", "first take"))),
    );
    await indexMediaCaptions(ctx(), mediaId, () =>
      Promise.resolve(vtt(cue("00:00:05.000", "00:00:06.000", "second take"))),
    );
    expect((await segmentsOf(mediaId)).map((s) => s.text)).toEqual(["second take"]);
  });

  it("counts a failed read, writes nothing else, and gives the track up after 3", async () => {
    const { mediaId, subs } = await mediaWith([
      ["de", false],
      ["en", false],
    ]);
    const broken = subs[0]?.storage_key;
    const read = (key: string) =>
      key === broken
        ? Promise.reject(new Error("gone"))
        : Promise.resolve(vtt(cue("00:00:01.000", "00:00:02.000", "english words")));
    for (let i = 1; i <= 3; i++) {
      expect(await indexMediaCaptions(ctx(), mediaId, read)).toBe("failed");
      expect(await segmentsOf(mediaId)).toEqual([]);
      expect((await subtitleState(mediaId))[0]?.index_failures).toBe(i);
    }
    // German is given up; English still gets indexed.
    expect(await indexMediaCaptions(ctx(), mediaId, read)).toBe("indexed");
    expect((await segmentsOf(mediaId)).map((s) => s.text)).toEqual(["english words"]);
    const [de, en] = await subtitleState(mediaId);
    expect(de).toMatchObject({ index_failures: 3, indexed_at: null });
    expect(en?.indexed_at).not.toBeNull();
  });

  it("does nothing, when asked only for waiting tracks, once none waits", async () => {
    const { mediaId } = await mediaWith([["en", false]]);
    const read = () => Promise.resolve(vtt(cue("00:00:01.000", "00:00:02.000", "words")));
    expect(await indexMediaCaptions(ctx(), mediaId, read, { onlyIfPending: true })).toBe("indexed");
    expect(await indexMediaCaptions(ctx(), mediaId, read, { onlyIfPending: true })).toBe("skipped");
  });

  it("loses the segments with their media", async () => {
    const { mediaId } = await mediaWith([["en", false]]);
    await indexMediaCaptions(ctx(), mediaId, () =>
      Promise.resolve(vtt(cue("00:00:01.000", "00:00:02.000", "doomed"))),
    );
    await testDb.db.deleteFrom("library_entries").where("media_id", "=", mediaId).execute();
    await testDb.db.deleteFrom("renditions").where("media_id", "=", mediaId).execute();
    await testDb.db.deleteFrom("media").where("id", "=", mediaId).execute();
    expect(await segmentsOf(mediaId)).toEqual([]);
  });
});

/** A store of `files` that records the ranges it was asked for; a missing key throws. */
function fakeStore(files: Map<string, string>, sizes = new Map<string, number>()) {
  const ranges: (unknown[] | undefined)[] = [];
  const store = {
    stat: (key: string) => {
      const text = files.get(key);
      return Promise.resolve(
        text === undefined ? null : { size: sizes.get(key) ?? Buffer.byteLength(text) },
      );
    },
    open: (key: string, range?: { start: number; end?: number }) => {
      ranges.push(range === undefined ? undefined : [range.start, range.end]);
      const text = files.get(key);
      if (text === undefined) return Promise.reject(new Error(`no ${key}`));
      return Promise.resolve({
        body: new Blob([text]).stream(),
        size: text.length,
        contentType: "text/vtt",
      });
    },
  };
  return { store: store as unknown as MediaStore, ranges };
}

describe("storeReader", () => {
  it("reads a file, an empty one as nothing, and no more than 16 MiB of a big one", async () => {
    const { store, ranges } = fakeStore(
      new Map([
        ["a.vtt", "WEBVTT\n"],
        ["empty.vtt", ""],
        ["big.vtt", "WEBVTT\n"],
      ]),
      new Map([["big.vtt", MAX_CAPTION_BYTES * 2]]),
    );
    const read = storeReader(store);
    expect(await read("a.vtt")).toBe("WEBVTT\n");
    expect(await read("empty.vtt")).toBe("");
    await read("big.vtt");
    expect(ranges).toEqual([undefined, [0, MAX_CAPTION_BYTES - 1]]);
    await expect(read("missing.vtt")).rejects.toThrow();
  });
});

describe("indexPendingCaptions", () => {
  it("indexes the media whose tracks wait, once", async () => {
    const { mediaId, subs } = await mediaWith([["en", false]]);
    const key = subs[0]?.storage_key ?? "";
    const { store } = fakeStore(
      new Map([[key, vtt(cue("00:00:01.000", "00:00:02.000", "caught up"))]]),
    );
    expect(await indexPendingCaptions(ctx(), store)).toBeGreaterThanOrEqual(1);
    expect((await segmentsOf(mediaId)).map((s) => s.text)).toEqual(["caught up"]);
    expect(await indexPendingCaptions(ctx(), store)).toBe(0);
  });
});
