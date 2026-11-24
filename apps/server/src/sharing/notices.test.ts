import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queuedData } from "../../test/jobs.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { sharedNotice } from "./notices.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  alice = await signedIn(t.db, { username: "snalice" });
  bob = await signedIn(t.db, { username: "snbob" });
  carol = await signedIn(t.db, { username: "sncarol" });
  await t.db
    .updateTable("users")
    .set({ groups: JSON.stringify(["family"]) })
    .where("id", "in", [alice.userId, bob.userId, carol.userId])
    .execute();
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(
    createApp(
      { db: t.db, valkey: h.ctx.valkey, version: "t", logger, downloads: h.ctx },
      { webDist: null },
    ),
    s,
  );
const put = (s: SignedIn, path: string, json: unknown) =>
  app(s).request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });

async function notices(userId: string) {
  const jobs = await queuedData<NotifyJob>(t.db, "notify");
  return jobs.filter((d) => d.userId === userId);
}

describe("shared with you", () => {
  it("words a video and a playlist", () => {
    expect(
      sharedNotice("Alice", "Big Buck Bunny", { kind: "entry", id: "e1", shareId: "s1" }),
    ).toEqual({
      title: "Alice shared Big Buck Bunny with you",
      path: "/library/e1",
      tag: "share-s1",
    });
    expect(sharedNotice("Alice", "Trip", { kind: "playlist", id: "p1", shareId: "s1" })).toEqual({
      title: "Alice shared the playlist Trip with you",
      path: "/shared/s1",
      tag: "share-s1",
    });
  });

  it("sharing with a group notifies its members once, never the owner", async () => {
    const e = await seedEntry(t.db, alice.userId, { title: "Holiday" });
    const path = `/api/shares/entry/${e.entryId}/people`;
    expect(
      (await put(alice, path, { people: [{ kind: "user", id: bob.userId }], expiresAt: null }))
        .status,
    ).toBe(200);
    expect(
      (
        await put(alice, path, {
          people: [
            { kind: "user", id: bob.userId },
            { kind: "group", name: "family" },
          ],
          expiresAt: null,
        })
      ).status,
    ).toBe(200);
    expect((await notices(bob.userId)).map((x) => x.message.title)).toEqual([
      "snalice shared Holiday with you",
    ]);
    expect(await notices(carol.userId)).toHaveLength(1);
    expect(await notices(alice.userId)).toEqual([]);
  });

  it("someone who turned shares off hears nothing", async () => {
    const dave = await signedIn(t.db, { username: "sndave" });
    await t.db
      .insertInto("notification_prefs")
      .values({ user_id: dave.userId, shares: false })
      .execute();
    const e = await seedEntry(t.db, alice.userId);
    await put(alice, `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "user", id: dave.userId }],
      expiresAt: null,
    });
    expect(await notices(dave.userId)).toEqual([]);
  });
});
