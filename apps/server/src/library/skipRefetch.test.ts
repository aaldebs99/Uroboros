import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { liveJobs } from "../../test/jobs.ts";
import { seedDownloadedEntry, seedEntry, seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { latestDownload, skipsJobKey } from "./skipRefetch.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger, downloads: h.ctx }, { webDist: null }), s);
const user = () => signedIn(t.db, { username: `sr${String(++n)}` });
const refetch = (s: SignedIn, entryId: string) =>
  app(s).request(`/api/library/${entryId}/skip-segments/refetch`, { method: "POST" });
const item = async (s: SignedIn, entryId: string) =>
  LibraryItem.parse(await (await app(s).request(`/api/library/${entryId}`)).json());
const skipsJobs = async () => (await liveJobs(t.db, "probe")).filter((j) => j.name === "skips");

async function shareWith(owner: SignedIn, friend: SignedIn, entryId: string) {
  const share = await t.db
    .insertInto("shares")
    .values({ owner_id: owner.userId, entry_id: entryId, mode: "people" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("share_people")
    .values({ share_id: share.id, user_id: friend.userId })
    .execute();
}

describe("refetching an entry's SponsorBlock segments", () => {
  it("queues one probe job per entry, however often it is asked while that one waits", async () => {
    const me = await user();
    const e = await seedDownloadedEntry(t.db, me.userId);
    expect((await refetch(me, e.entryId)).status).toBe(202);
    expect((await refetch(me, e.entryId)).status).toBe(202);
    const jobs = (await skipsJobs()).filter((j) => j.key === skipsJobKey(e.entryId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ entryId: e.entryId, userId: me.userId });
    expect(jobs[0]?.attempts).toBe(0);
  });

  it("is 404 for someone else's entry, shared with the caller or not", async () => {
    const [owner, friend] = [await user(), await user()];
    const e = await seedDownloadedEntry(t.db, owner.userId);
    expect((await refetch(friend, e.entryId)).status).toBe(404);
    await shareWith(owner, friend, e.entryId);
    expect((await refetch(friend, e.entryId)).status).toBe(404);
    expect((await item(friend, e.entryId)).sponsorSegmentsRefetchable).toBe(false);
  });

  it("is 409 for a video with no segments to fetch, and the item says so", async () => {
    const me = await user();
    const cases = [
      // An upload: no download made it.
      await seedProfileless(t.db, me.userId, { uploadedBy: me.userId }),
      // No download row either (a file the download history no longer names).
      await seedEntry(t.db, me.userId),
      // Its extra arguments cut the file: SponsorBlock's times no longer fit it.
      await seedDownloadedEntry(t.db, me.userId, {
        args: { extraArgs: ["--sponsorblock-remove=sponsor"] },
      }),
      await seedDownloadedEntry(t.db, me.userId, {
        args: { extraArgs: ["--download-sections", "*0-60"] },
      }),
      // SponsorBlock covers YouTube alone.
      await seedDownloadedEntry(t.db, me.userId, { extractor: "vimeo" }),
    ];
    for (const e of cases) {
      const res = await refetch(me, e.entryId);
      expect(res.status, e.entryId).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe("conflict");
      expect((await item(me, e.entryId)).sponsorSegmentsRefetchable).toBe(false);
    }
    const ids = new Set(cases.map((e) => skipsJobKey(e.entryId)));
    expect((await skipsJobs()).filter((j) => ids.has(j.key ?? ""))).toEqual([]);
  });

  it("is offered on the owner's own downloaded YouTube video", async () => {
    const me = await user();
    const e = await seedDownloadedEntry(t.db, me.userId);
    expect((await item(me, e.entryId)).sponsorSegmentsRefetchable).toBe(true);
  });

  it("is offered on an audio download too, and on one whose profile skipped nothing", async () => {
    const me = await user();
    for (const args of [{ audioOnly: true, audioFormat: "opus" }, { sponsorblockRemove: [] }]) {
      const e = await seedDownloadedEntry(t.db, me.userId, { args });
      expect((await refetch(me, e.entryId)).status).toBe(202);
      expect((await item(me, e.entryId)).sponsorSegmentsRefetchable).toBe(true);
    }
  });

  it("finds the file's latest download by index, not by reading the whole download history", async () => {
    const me = await user();
    const e = await seedDownloadedEntry(t.db, me.userId);
    const plan = await t.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL enable_seqscan = off`.execute(tx);
      const rows = await latestDownload(tx, e.renditionId).explain();
      return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
    });
    expect(plan).toContain("downloads_rendition_idx");
  });
});
