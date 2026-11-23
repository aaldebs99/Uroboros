import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import type { TranscodeState } from "../db/schema.ts";
import { reconcileTranscodes } from "./reconcile.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

async function copy(state: TranscodeState, minutesAgo: { used: number; started: number | null }) {
  const p = await seededDefault(t.db);
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: `media/${m.id}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const c = await t.db
    .insertInto("transcodes")
    .values({
      source_rendition_id: r.id,
      encoder: "libx264",
      settings: "s",
      state,
      last_used_at: ago(minutesAgo.used),
      started_at: minutesAgo.started === null ? null : ago(minutesAgo.started),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return c.id;
}

const job = (id: string) => h.queues.transcode.getJob(`transcode|${id}`);

describe("transcode reconcile", () => {
  it("re-adds the job of a running copy whose job is gone", async () => {
    const running = await copy("running", { used: 30, started: 5 });
    const waiting = await copy("queued", { used: 1, started: null });
    const justStarted = await copy("running", { used: 1, started: 0 });
    await reconcileTranscodes(h.ctx);
    expect(await job(running)).toBeDefined();
    expect(await job(waiting)).toBeDefined();
    expect(await job(justStarted)).toBeUndefined();
  });

  it("leaves a queued copy nobody asked about for 10 minutes", async () => {
    const stale = await copy("queued", { used: 11, started: null });
    await reconcileTranscodes(h.ctx);
    expect(await job(stale)).toBeUndefined();
  });
});
