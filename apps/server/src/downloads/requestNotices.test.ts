import type { Insertable } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import type { DownloadsTable } from "../db/schema.ts";
import { retryDownload } from "./dispatch.ts";
import { noticeFinishedRequests, readyNotice } from "./requestNotices.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let profile: { id: string; revision: string };

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  profile = await seededDefault(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

let n = 0;
const deps = () => ({ db: t.db, queues: h.queues });

async function notices(userId: string) {
  const jobs = await h.queues.notify.getJobs(["waiting", "delayed", "prioritized"]);
  return jobs.filter((j) => j.data.userId === userId).map((j) => j.data);
}

async function request(userId: string, title: string | null = "Blender shorts") {
  const r = await t.db
    .insertInto("download_requests")
    .values({ user_id: userId, url: "https://x", profile_id: profile.id, state: "queued", title })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}

async function download(
  userId: string,
  requestId: string | null,
  state: "queued" | "running" | "done" | "failed" | "cancelled",
  over: Partial<Insertable<DownloadsTable>> = {},
) {
  const videoId = `rn${String(++n)}`;
  const row = await t.db
    .insertInto("downloads")
    .values({
      user_id: userId,
      request_id: requestId,
      profile_id: profile.id,
      profile_revision: profile.revision,
      args: "[]",
      extractor: "youtube",
      video_id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: `Video ${videoId}`,
      fetch_key: `youtube|${videoId}|${profile.id}|${profile.revision}`,
      state,
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const settle = (id: string, state: "done" | "failed", error: string | null = null) =>
  t.db.updateTable("downloads").set({ state, error_message: error }).where("id", "=", id).execute();

describe("Ready and Failed notifications", () => {
  it("words one, many and failures", () => {
    expect(readyNotice({ id: "r1", title: "Mix" }, [{ title: "One", entryId: "e1" }], [])).toEqual({
      message: { title: "Ready: One", path: "/library/e1", tag: "request-r1" },
      urgency: "normal",
    });
    const many = readyNotice(
      { id: "r1", title: "Mix" },
      [
        { title: "A", entryId: "a" },
        { title: "B", entryId: "b" },
        { title: "C", entryId: "c" },
        { title: "D", entryId: "d" },
      ],
      [],
    );
    expect(many).toEqual({
      message: {
        title: "4 videos from Mix are ready",
        body: "A\nB\nC",
        path: "/",
        tag: "request-r1",
      },
      urgency: "normal",
    });
    expect(
      readyNotice(
        { id: "r1", title: null },
        [
          { title: "A", entryId: "a" },
          { title: "B", entryId: "b" },
        ],
        [],
      ).message.title,
    ).toBe("2 videos are ready");
    expect(
      readyNotice({ id: "r1", title: "Mix" }, [], [{ title: "One", message: "Video unavailable" }]),
    ).toEqual({
      message: {
        title: "Failed: One",
        body: "Video unavailable",
        path: "/downloads",
        tag: "request-r1",
      },
      urgency: "high",
    });
    expect(
      readyNotice(
        { id: "r1", title: "Mix" },
        [{ title: "A", entryId: "a" }],
        [{ title: "B", message: null }],
      ),
    ).toEqual({
      message: {
        title: "1 of 2 downloads failed",
        body: "B",
        path: "/downloads",
        tag: "request-r1",
      },
      urgency: "high",
    });
  });

  it("one Ready when the last of a request's downloads settles", async () => {
    const u = await signedIn(t.db, { username: "rn-last" });
    const req = await request(u.userId);
    const a = await download(u.userId, req, "running");
    const b = await download(u.userId, req, "queued");
    await settle(a, "done");
    await noticeFinishedRequests(deps(), [a]);
    expect(await notices(u.userId)).toEqual([]);
    await settle(b, "done");
    await noticeFinishedRequests(deps(), [b]);
    const sent = await notices(u.userId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.title).toBe("2 videos from Blender shorts are ready");
  });

  it("already stored downloads count toward N, cancelled ones do not", async () => {
    const u = await signedIn(t.db, { username: "rn-stored" });
    const req = await request(u.userId, null);
    await download(u.userId, req, "done");
    await download(u.userId, req, "cancelled");
    const fetched = await download(u.userId, req, "running");
    await settle(fetched, "done");
    await noticeFinishedRequests(deps(), [fetched]);
    expect((await notices(u.userId))[0]?.message.title).toBe("2 videos are ready");
  });

  it("one finished video opens its watch page", async () => {
    const u = await signedIn(t.db, { username: "rn-one" });
    const e = await seedEntry(t.db, u.userId);
    const req = await request(u.userId);
    const d = await download(u.userId, req, "running", { title: "The one" });
    await t.db
      .updateTable("downloads")
      .set({ state: "done", rendition_id: e.renditionId })
      .where("id", "=", d)
      .execute();
    await noticeFinishedRequests(deps(), [d]);
    expect((await notices(u.userId))[0]?.message).toMatchObject({
      title: "Ready: The one",
      path: `/library/${e.entryId}`,
    });
  });

  it("a failure turns it into k of N failed at high urgency", async () => {
    const u = await signedIn(t.db, { username: "rn-fail" });
    const req = await request(u.userId);
    const a = await download(u.userId, req, "running");
    const b = await download(u.userId, req, "running");
    await settle(a, "done");
    await settle(b, "failed", "Video unavailable");
    await noticeFinishedRequests(deps(), [a, b]);
    const sent = await notices(u.userId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      urgency: "high",
      message: { title: "1 of 2 downloads failed" },
    });
  });

  it("a subscription's downloads send nothing", async () => {
    const u = await signedIn(t.db, { username: "rn-sub" });
    const d = await download(u.userId, null, "running");
    await settle(d, "done");
    await noticeFinishedRequests(deps(), [d]);
    expect(await notices(u.userId)).toEqual([]);
  });

  it("a retry that settles again notifies again", async () => {
    const u = await signedIn(t.db, { username: "rn-retry" });
    const req = await request(u.userId);
    const d = await download(u.userId, req, "running", { title: "Retried" });
    await settle(d, "failed", "boom");
    await noticeFinishedRequests(deps(), [d]);
    await retryDownload(h.ctx, { userId: u.userId, role: "member", via: "session" }, d);
    const noticed = await t.db
      .selectFrom("download_requests")
      .select("noticed_at")
      .where("id", "=", req)
      .executeTakeFirstOrThrow();
    expect(noticed.noticed_at).toBeNull();
    await settle(d, "done");
    await noticeFinishedRequests(deps(), [d]);
    const titles = (await notices(u.userId)).map((x) => x.message.title).sort();
    expect(titles).toEqual(["Failed: Retried", "Ready: Retried"]);
  });

  it("two settles at once notify once", async () => {
    const u = await signedIn(t.db, { username: "rn-race" });
    const req = await request(u.userId);
    const a = await download(u.userId, req, "done");
    const b = await download(u.userId, req, "done");
    await Promise.all([noticeFinishedRequests(deps(), [a]), noticeFinishedRequests(deps(), [b])]);
    expect(await notices(u.userId)).toHaveLength(1);
  });

  it("downloads turned off sends nothing", async () => {
    const u = await signedIn(t.db, { username: "rn-off" });
    await t.db
      .insertInto("notification_prefs")
      .values({ user_id: u.userId, downloads: false })
      .execute();
    const req = await request(u.userId);
    const d = await download(u.userId, req, "done");
    await noticeFinishedRequests(deps(), [d]);
    expect(await notices(u.userId)).toEqual([]);
  });
});
