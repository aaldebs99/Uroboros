import type { OpenAPIHono } from "@hono/zod-openapi";
import { ShareState } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { setPeople } from "./manage.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let family: string;

/** A group of these people. */
async function group(name: string, members: string[]): Promise<string> {
  const g = await t.db
    .insertInto("groups")
    .values({ name })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("group_members")
    .values(members.map((user_id) => ({ group_id: g.id, user_id })))
    .execute();
  return g.id;
}

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "mgalice" });
  bob = await signedIn(t.db, { username: "mgbob" });
  carol = await signedIn(t.db, { username: "mgcarol" });
  family = await group("Family", [alice.userId, bob.userId, carol.userId]);
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const state = async (res: Response) => {
  expect(res.status).toBe(200);
  return ShareState.parse(await res.json());
};

describe("managing shares", () => {
  it("shares a video with a user and a group", async () => {
    const e = await seedEntry(t.db, alice.userId, { title: "Holiday" });
    const s = await state(
      await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
        people: [
          { kind: "user", id: bob.userId },
          { kind: "group", id: family },
        ],
        expiresAt: null,
      }),
    );
    expect(s).toMatchObject({ kind: "entry", id: e.entryId, title: "Holiday", link: null });
    expect(s.people?.people).toEqual(
      expect.arrayContaining([
        { kind: "user", id: bob.userId, name: "mgbob", handle: "mgbob" },
        { kind: "group", id: family, name: "Family", members: 3 },
      ]),
    );
    expect(s.people?.expired).toBe(false);
    const again = await state(await send(alice, "GET", `/api/shares/entry/${e.entryId}`));
    expect(again.people?.people).toHaveLength(2);
    const cleared = await state(
      await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
        people: [],
        expiresAt: null,
      }),
    );
    expect(cleared.people).toBeNull();
  });

  it("naming yourself, or someone unknown, is 400", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const self = await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "user", id: alice.userId }],
      expiresAt: null,
    });
    expect(self.status).toBe(400);
    const unknown = await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "user", id: crypto.randomUUID() }],
      expiresAt: null,
    });
    expect(unknown.status).toBe(400);
  });

  it("another person's video is 404", async () => {
    const theirs = await seedEntry(t.db, bob.userId);
    expect((await send(alice, "GET", `/api/shares/entry/${theirs.entryId}`)).status).toBe(404);
    const res = await send(alice, "PUT", `/api/shares/entry/${theirs.entryId}/link`, {
      allowDownload: false,
      expiresAt: null,
    });
    expect(res.status).toBe(404);
  });

  it("a link keeps its code when changed, and gets a new one when turned off and on", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const path = `/api/shares/entry/${e.entryId}/link`;
    const on = await state(
      await send(alice, "PUT", path, { allowDownload: false, expiresAt: null }),
    );
    expect(on.link?.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(on.link?.path).toBe(`/s/${on.link?.code ?? ""}`);
    const changed = await state(
      await send(alice, "PUT", path, { allowDownload: true, expiresAt: null }),
    );
    expect(changed.link).toMatchObject({ code: on.link?.code, allowDownload: true });
    expect((await send(alice, "DELETE", path)).status).toBe(204);
    const fresh = await state(
      await send(alice, "PUT", path, { allowDownload: false, expiresAt: null }),
    );
    expect(fresh.link?.code).not.toBe(on.link?.code);
  });

  it("an expired link is listed as expired, and extending it keeps the code", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const path = `/api/shares/entry/${e.entryId}/link`;
    const past = new Date(Date.now() - 60_000).toISOString();
    const expired = await state(
      await send(alice, "PUT", path, { allowDownload: false, expiresAt: past }),
    );
    expect(expired.link?.expired).toBe(true);
    const mine = z.array(ShareState).parse(await (await send(alice, "GET", "/api/shares")).json());
    expect(mine.find((x) => x.id === e.entryId)?.link?.expired).toBe(true);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const extended = await state(
      await send(alice, "PUT", path, { allowDownload: false, expiresAt: future }),
    );
    expect(extended.link).toMatchObject({ code: expired.link?.code, expired: false });
  });

  it("lists both modes of a thing once under By me", async () => {
    const e = await seedEntry(t.db, alice.userId);
    await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    await send(alice, "PUT", `/api/shares/entry/${e.entryId}/link`, {
      allowDownload: false,
      expiresAt: null,
    });
    const mine = z.array(ShareState).parse(await (await send(alice, "GET", "/api/shares")).json());
    const rows = mine.filter((x) => x.id === e.entryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.people).not.toBeNull();
    expect(rows[0]?.link).not.toBeNull();
  });

  it("shares a playlist of either kind", async () => {
    const p = await t.db
      .insertInto("playlists")
      .values({ user_id: alice.userId, name: "Trip" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const s = await state(
      await send(alice, "PUT", `/api/shares/playlist/${p.id}/link`, {
        allowDownload: true,
        expiresAt: null,
      }),
    );
    expect(s).toMatchObject({ kind: "playlist", title: "Trip" });
    expect((await send(bob, "GET", `/api/shares/playlist/${p.id}`)).status).toBe(404);
  });

  it("reports only the people a change newly reaches, never the owner", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const first = await setPeople(t.db, alice.userId, "entry", e.entryId, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    expect(first.newlyReached).toEqual([bob.userId]);
    const second = await setPeople(t.db, alice.userId, "entry", e.entryId, {
      people: [
        { kind: "user", id: bob.userId },
        { kind: "group", id: family },
      ],
      expiresAt: null,
    });
    expect(second.newlyReached).toEqual([carol.userId]);
    expect(second.shareId).toBe(first.shareId);
  });

  it("sharing with a group you're not in, or one that's gone, is 400", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const theirs = await group("Theirs", [bob.userId]);
    for (const id of [theirs, crypto.randomUUID()]) {
      const res = await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
        people: [{ kind: "group", id }],
        expiresAt: null,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe("no such group");
    }
  });

  it("the sign-in provider's group names are no longer accepted", async () => {
    const e = await seedEntry(t.db, alice.userId);
    const res = await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "group", name: "family" }],
      expiresAt: null,
    });
    expect(res.status).toBe(400);
  });
});
