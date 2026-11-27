import { fixture } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { queuedData } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { ExportJob, NotifyJob } from "../downloads/queues.ts";
import { exportProcessor } from "./exportRun.ts";

/** Making a clip (docs/sharing.md#clips): a copy of one range, here 0.5–2.5 s of a 3 s file. */

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** A clip queued of the probe fixture's 3 s file, with two chapters, made as `format`. */
async function queuedClip(format = "mp4"): Promise<{ id: string; userId: string; title: string }> {
  const me = await signedIn(t.db, { username: `xc${String(++n)}` });
  const title = `Film ${String(n)}`;
  const e = await seedEntry(t.db, me.userId, { title });
  await t.db
    .updateTable("media")
    .set({
      chapters: JSON.stringify([
        { start: 0, end: 1.5, title: "Start" },
        { start: 1.5, end: 3, title: "End" },
      ]),
    })
    .where("id", "=", e.mediaId)
    .execute();
  const row = await t.db
    .insertInto("exports")
    .values({
      user_id: me.userId,
      entry_id: e.entryId,
      rendition_id: e.renditionId,
      cuts: JSON.stringify([
        { start: 0, end: 0.5 },
        { start: 2.5, end: 3 },
      ]),
      format,
      clip_start: 0.5,
      clip_end: 2.5,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, userId: me.userId, title };
}

const job = (exportId: string) => ({
  id: `j-${exportId}`,
  queue: "export" as const,
  name: "export",
  key: `export:${exportId}`,
  data: { exportId } satisfies ExportJob,
  attemptsMade: 0,
  opts: { attempts: 1 },
  signal: new AbortController().signal,
});

const OUTPUT = "{{lastArg}}";
const progress = (s: number) => ({
  stdout: `out_time_us=${String(s * 1_000_000)}\nprogress=continue\n`,
});

describe("making a clip", () => {
  it("seeks to its start, trims its length, puts its chapters on its timeline and tells its person", async () => {
    const clip = await queuedClip();
    const probe = JSON.parse(await fixture("ffprobe-clip.json")) as unknown;
    const deps = await h.sessionDeps(
      { steps: [progress(1), { writeFile: OUTPUT, content: "clip bytes" }] },
      probe,
    );
    const ffmpegRun = h.runs.at(-2);
    await exportProcessor(deps).process(job(clip.id));
    const row = await t.db
      .selectFrom("exports")
      .select(["state", "progress"])
      .where("id", "=", clip.id)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe("done");
    const args = (await ffmpegRun?.argv()) ?? [];
    const media = args.indexOf("-ss");
    expect(args.slice(media, media + 2)).toEqual(["-ss", "0.500"]);
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("[0:0]trim=start=0.000:end=2.000,setpts=PTS-STARTPTS[v0]");
    expect(graph).toContain("concat=n=1");
    // Both chapters overlap the clip: Start from its beginning to 1 s in, End from there.
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("1");
    const notices = await queuedData<NotifyJob>(t.db, "notify");
    expect(notices.find((j) => j.userId === clip.userId)?.message).toMatchObject({
      title: "Ready to save",
      body: `A clip of ${clip.title} (0:01–0:03)`,
    });
  });

  it("trims an audio clip's samples from the start of the file, with no seek", async () => {
    const clip = await queuedClip("mp3");
    const deps = await h.sessionDeps(
      { steps: [progress(1), { writeFile: OUTPUT, content: "mp3 bytes" }] },
      {
        streams: [
          { index: 0, codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2 },
        ],
        format: { format_name: "mp3", start_time: "0.000000", duration: "3.000000" },
      },
    );
    const ffmpegRun = h.runs.at(-2);
    await exportProcessor(deps).process(job(clip.id));
    const args = (await ffmpegRun?.argv()) ?? [];
    expect(args).not.toContain("-ss");
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("[0:0]atrim=start=0.500:end=2.500,asetpts=PTS-STARTPTS[a0]");
    // One range: not the release before's two (the clip, then an empty one at the file's end).
    expect(graph).toContain("concat=n=1");
  });
});
