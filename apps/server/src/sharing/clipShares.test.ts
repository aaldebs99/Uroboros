import type { OpenAPIHono } from "@hono/zod-openapi";
import { SharedWithMe, ShareState } from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedClip } from "../../test/clips.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { NotifyJob } from "../downloads/queues.ts";

/** Sharing a clip on its own (docs/sharing.md#clips), by its owner, with people and by a link. */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let family: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  alice = await signedIn(t.db, { username: "csalice" });
  bob = await signedIn(t.db, { username: "csbob" });
  carol = await signedIn(t.db, { username: "cscarol" });
  family = (
    await t.db
      .insertInto("groups")
      .values({ name: "Family" })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  await t.db
    .insertInto("group_members")
    .values([alice, bob].map((u) => ({ group_id: family, user_id: u.userId })))
    .execute();
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
const send = (a: OpenAPIHono, method: string, path: string, json?: unknown) =>
  a.request(path, {
    method,
    ...(json === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(json) }),
  });
const people = (...who: SignedIn[]) => ({
  people: who.map((p) => ({ kind: "user", id: p.userId })),
  expiresAt: null,
});

describe("sharing a clip on its own", () => {
  it("with people: its state is a clip's, and the people it reaches hear of it, opening its page", async () => {
    const c = await seedClip(t.db, alice.userId, { title: "Holiday" });
    const res = await send(app(alice), "PUT", `/api/shares/clip/${c.exportId}/people`, people(bob));
    expect(res.status).toBe(200);
    expect(ShareState.parse(await res.json())).toMatchObject({
      kind: "clip",
      id: c.exportId,
      title: "Holiday (clip 1:02–1:30)",
      people: { people: [{ kind: "user", id: bob.userId }] },
    });
    const told = (await queuedData<NotifyJob>(t.db, "notify")).filter(
      (j) => j.userId === bob.userId,
    );
    expect(told.map((j) => j.message)).toEqual([
      expect.objectContaining({
        title: "csalice shared Holiday (clip 1:02–1:30) with you",
        path: `/shared/clips/${c.exportId}`,
      }),
    ]);
  });

  it("works while the clip is being made", async () => {
    const c = await seedClip(t.db, alice.userId);
    const res = await send(app(alice), "PUT", `/api/shares/clip/${c.exportId}/link`, {
      allowDownload: false,
      expiresAt: null,
    });
    expect(res.status).toBe(200);
    expect(ShareState.parse(await res.json()).link?.path).toMatch(/^\/s\//);
  });

  it("is only for a clip of one's own video (404 for a clip of one shared with you)", async () => {
    const theirs = await seedClip(t.db, alice.userId);
    const mine = await seedClip(t.db, bob.userId, { entryId: theirs.entryId });
    const res = await send(
      app(bob),
      "PUT",
      `/api/shares/clip/${mine.exportId}/people`,
      people(carol),
    );
    expect(res.status).toBe(404);
  });

  it("lists under By me, With me and the group's page", async () => {
    const c = await seedClip(t.db, alice.userId);
    await send(app(alice), "PUT", `/api/shares/clip/${c.exportId}/people`, {
      people: [{ kind: "group", id: family }],
      expiresAt: null,
    });
    const mine = z.array(ShareState).parse(await (await app(alice).request("/api/shares")).json());
    expect(mine.map((s) => [s.kind, s.id])).toContainEqual(["clip", c.exportId]);
    const withMe = z
      .array(SharedWithMe)
      .parse(await (await app(bob).request("/api/shared")).json());
    expect(withMe.find((s) => s.id === c.exportId)).toMatchObject({
      kind: "clip",
      owner: "csalice",
    });
    const group = (await (await app(bob).request(`/api/groups/${family}/shares`)).json()) as {
      kind: string;
      id: string;
    }[];
    expect(group.map((s) => [s.kind, s.id])).toContainEqual(["clip", c.exportId]);
  });

  it("is refused while clips are off (409), though its owner still sees and stops it, and nobody else lists it", async () => {
    const c = await seedClip(t.db, alice.userId);
    await send(app(alice), "PUT", `/api/shares/clip/${c.exportId}/people`, people(bob));
    const off = app(alice, false);
    expect(
      (await send(off, "PUT", `/api/shares/clip/${c.exportId}/people`, people(carol))).status,
    ).toBe(409);
    expect(
      (
        await send(off, "PUT", `/api/shares/clip/${c.exportId}/link`, {
          allowDownload: false,
          expiresAt: null,
        })
      ).status,
    ).toBe(409);
    expect((await off.request(`/api/shares/clip/${c.exportId}`)).status).toBe(200);
    const withMe = z
      .array(SharedWithMe)
      .parse(await (await app(bob, false).request("/api/shared")).json());
    expect(withMe.map((s) => s.id)).not.toContain(c.exportId);
    const g = await seedClip(t.db, alice.userId);
    await send(app(alice), "PUT", `/api/shares/clip/${g.exportId}/people`, {
      people: [{ kind: "group", id: family }],
      expiresAt: null,
    });
    const group = (await (
      await app(bob, false).request(`/api/groups/${family}/shares`)
    ).json()) as {
      id: string;
    }[];
    expect(group.map((s) => s.id)).not.toContain(g.exportId);
    expect((await send(off, "DELETE", `/api/shares/clip/${c.exportId}/people`)).status).toBe(204);
  });
});
