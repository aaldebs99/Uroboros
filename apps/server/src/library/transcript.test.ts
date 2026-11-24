import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { readTranscript } from "./transcript.ts";

let testDb: TestDb;
let owner: string;
let entry: SeededEntry;

interface Run {
  text: string;
  line_at: number[];
  line_start: number[];
  end_s: number;
}

async function track(
  mediaId: string,
  lang: string,
  opts: { automatic?: boolean; indexed: boolean },
  runs: Run[] = [],
): Promise<void> {
  const sub = await testDb.db
    .insertInto("subtitles")
    .values({
      media_id: mediaId,
      lang,
      automatic: opts.automatic ?? false,
      storage_key: `subs/${mediaId}.${lang}.${String(opts.automatic ?? false)}.vtt`,
      indexed_at: opts.indexed ? new Date() : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (runs.length === 0) return;
  await testDb.db
    .insertInto("caption_segments")
    .values(
      runs.map((r, seq) => ({
        subtitle_id: sub.id,
        media_id: mediaId,
        seq,
        text: r.text,
        start_s: r.line_start[0] ?? 0,
        end_s: r.end_s,
        line_at: r.line_at,
        line_start: r.line_start,
      })),
    )
    .execute();
}

beforeAll(async () => {
  testDb = await TestDb.create();
  owner = (await signedIn(testDb.db, { username: "transcript" })).userId;
  entry = await seedEntry(testDb.db, owner, { title: "Talk" });
  await track(entry.mediaId, "en", { indexed: true }, [
    { text: "hello there general kenobi", line_at: [0, 12], line_start: [0, 2.5], end_s: 5 },
    { text: "you are a bold one", line_at: [0], line_start: [31], end_s: 33 },
  ]);
  await track(entry.mediaId, "en", { automatic: true, indexed: true }, [
    { text: "hello the are", line_at: [0], line_start: [0], end_s: 3 },
  ]);
  await track(entry.mediaId, "de", { automatic: true, indexed: true }, [
    { text: "hallo", line_at: [0], line_start: [1], end_s: 2 },
  ]);
  await track(entry.mediaId, "fr", { indexed: false });
});
afterAll(async () => {
  await testDb.close();
});

describe("readTranscript", () => {
  it("reads a video's own captions before automatic ones, line by line, with their starts", async () => {
    const t = await readTranscript(testDb.db, owner, entry.entryId, { maxLines: 100 });
    expect(t.track).toEqual({ lang: "en", automatic: false, indexed: true });
    expect(t.lines).toEqual([
      { start: 0, text: "hello there" },
      { start: 2.5, text: "general kenobi" },
      { start: 31, text: "you are a bold one" },
    ]);
    expect(t.nextFromSeconds).toBeNull();
  });

  it("lists every track, saying which have not been read yet", async () => {
    const t = await readTranscript(testDb.db, owner, entry.entryId, { maxLines: 1 });
    expect(t.tracks).toEqual([
      { lang: "en", automatic: false, indexed: true },
      { lang: "fr", automatic: false, indexed: false },
      { lang: "de", automatic: true, indexed: true },
      { lang: "en", automatic: true, indexed: true },
    ]);
  });

  it("reads the language asked for, and no track when that language has none read", async () => {
    const de = await readTranscript(testDb.db, owner, entry.entryId, { lang: "de", maxLines: 10 });
    expect(de.track?.lang).toBe("de");
    expect(de.lines).toEqual([{ start: 1, text: "hallo" }]);
    const fr = await readTranscript(testDb.db, owner, entry.entryId, { lang: "fr", maxLines: 10 });
    expect(fr.track).toBeNull();
    expect(fr.lines).toEqual([]);
  });

  it("starts from a moment and says where the next page begins", async () => {
    const t = await readTranscript(testDb.db, owner, entry.entryId, {
      fromSeconds: 2,
      maxLines: 1,
    });
    expect(t.lines).toEqual([{ start: 2.5, text: "general kenobi" }]);
    expect(t.nextFromSeconds).toBe(31);
  });

  it("keeps lines that start together on one page, so pages never repeat or stall", async () => {
    const cue = await seedEntry(testDb.db, owner, { title: "Cues" });
    await track(cue.mediaId, "en", { indexed: true }, [
      { text: "a b c", line_at: [0, 2, 4], line_start: [10, 10, 12], end_s: 14 },
    ]);
    const first = await readTranscript(testDb.db, owner, cue.entryId, { maxLines: 1 });
    expect(first.lines).toEqual([
      { start: 10, text: "a" },
      { start: 10, text: "b" },
    ]);
    expect(first.nextFromSeconds).toBe(12);
    const second = await readTranscript(testDb.db, owner, cue.entryId, {
      fromSeconds: 12,
      maxLines: 1,
    });
    expect(second.lines).toEqual([{ start: 12, text: "c" }]);
    expect(second.nextFromSeconds).toBeNull();
  });

  it("answers 404 for someone else's video", async () => {
    const stranger = (await signedIn(testDb.db, { username: "transcript2" })).userId;
    await expect(
      readTranscript(testDb.db, stranger, entry.entryId, { maxLines: 10 }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
