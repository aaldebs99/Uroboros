import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { sharedNotice } from "./notices.ts";

/**
 * Sharing the whole video, opened at a clip (docs/sharing.md#clips): an ordinary share of the
 * video whose notice says it is a clip and opens at its range.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  alice = await signedIn(t.db, { username: "cnalice" });
  bob = await signedIn(t.db, { username: "cnbob" });
  carol = await signedIn(t.db, { username: "cncarol" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn, clipsEnabled = true): OpenAPIHono =>
  asUser(
    createApp(
      { db: t.db, version: "t", logger, downloads: h.ctx },
      { webDist: null, clipsEnabled },
    ),
    s,
  );
const put = (a: OpenAPIHono, path: string, json: unknown) =>
  a.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });
const to = (...people: SignedIn[]) => people.map((p) => ({ kind: "user", id: p.userId }));

async function notices(userId: string) {
  const jobs = await queuedData<NotifyJob>(t.db, "notify");
  return jobs.filter((d) => d.userId === userId).map((d) => d.message);
}

describe("a clip of a whole video", () => {
  it("is worded as a clip, says its range, and opens at it, under the share's tag", () => {
    expect(
      sharedNotice(
        "Alice",
        "Holiday",
        { kind: "entry", id: "e1", shareId: "s1" },
        { start: 62, end: 90 },
      ),
    ).toEqual({
      title: "Alice shared a clip of Holiday with you",
      body: "1:02–1:30",
      path: "/library/e1?t=62&end=90",
      tag: "share-s1",
    });
  });

  it("tells only the people the share newly reaches, with the clip's notice", async () => {
    const e = await seedEntry(t.db, alice.userId, { title: "Holiday" });
    const path = `/api/shares/entry/${e.entryId}/people`;
    expect((await put(app(alice), path, { people: to(bob), expiresAt: null })).status).toBe(200);
    const clip = { start: 62, end: 90 };
    const res = await put(app(alice), path, { people: to(bob, carol), expiresAt: null, clip });
    expect(res.status).toBe(200);
    expect(await notices(carol.userId)).toEqual([
      expect.objectContaining({
        title: "cnalice shared a clip of Holiday with you",
        path: `/library/${e.entryId}?t=62&end=90`,
      }),
    ]);
    expect((await notices(bob.userId)).map((m) => m.title)).toEqual([
      "cnalice shared Holiday with you",
    ]);
  });

  it("is refused on a playlist (400), and while clips are off (409)", async () => {
    const list = await t.db
      .insertInto("playlists")
      .values({ user_id: alice.userId, name: "Trip" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const clip = { start: 1, end: 3 };
    const onList = await put(app(alice), `/api/shares/playlist/${list.id}/people`, {
      people: to(bob),
      expiresAt: null,
      clip,
    });
    expect(onList.status).toBe(400);
    const e = await seedEntry(t.db, alice.userId);
    const off = await put(app(alice, false), `/api/shares/entry/${e.entryId}/people`, {
      people: to(bob),
      expiresAt: null,
      clip,
    });
    expect(off.status).toBe(409);
  });
});
