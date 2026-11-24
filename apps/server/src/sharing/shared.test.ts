import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  Directory,
  LibraryPage,
  PlaylistDetail,
  SharedDetail,
  SharedWithMe,
} from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "shalice" });
  bob = await signedIn(t.db, { username: "shbob" });
  carol = await signedIn(t.db, { username: "shcarol" });
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

/** Alice's playlist of two videos, shared with Bob; returns the ids. */
async function sharedPlaylist(expiresAt: string | null = null) {
  const first = await seedEntry(t.db, alice.userId, { title: "First", thumbnail: true });
  const second = await seedEntry(t.db, alice.userId, { title: "Second" });
  const p = await send(alice, "POST", "/api/playlists", {
    name: "Alice's picks",
    entryIds: [second.entryId, first.entryId],
  });
  const playlist = PlaylistDetail.parse(await p.json());
  const put = await send(alice, "PUT", `/api/shares/playlist/${playlist.id}/people`, {
    people: [{ kind: "user", id: bob.userId }],
    expiresAt,
  });
  expect(put.status).toBe(200);
  const share = await t.db
    .selectFrom("shares")
    .select("id")
    .where("playlist_id", "=", playlist.id)
    .where("mode", "=", "people")
    .executeTakeFirstOrThrow();
  return { playlist, first, second, shareId: share.id };
}

const withMe = async (s: SignedIn) =>
  z.array(SharedWithMe).parse(await (await send(s, "GET", "/api/shared")).json());

describe("what is shared with me", () => {
  it("lists a shared playlist with its owner and size", async () => {
    const { playlist, shareId } = await sharedPlaylist();
    const mine = await withMe(bob);
    expect(mine.find((x) => x.shareId === shareId)).toMatchObject({
      kind: "playlist",
      id: playlist.id,
      title: "Alice's picks",
      count: 2,
      owner: "shalice",
    });
    expect((await withMe(carol)).some((x) => x.shareId === shareId)).toBe(false);
    expect((await withMe(alice)).some((x) => x.shareId === shareId)).toBe(false);
    const detail = SharedDetail.parse(
      await (await send(bob, "GET", `/api/shared/${shareId}`)).json(),
    );
    expect(detail).toMatchObject({
      kind: "playlist",
      title: "Alice's picks",
      owner: "shalice",
      count: 2,
    });
    expect((await send(carol, "GET", `/api/shared/${shareId}`)).status).toBe(404);
  });

  it("lists the playlist's videos in order with the recipient's own progress", async () => {
    const { first, second, shareId } = await sharedPlaylist();
    await send(bob, "PUT", `/api/library/${first.entryId}/progress`, {
      position: 50,
      duration: 100,
    });
    const page = LibraryPage.parse(
      await (await send(bob, "GET", `/api/shared/${shareId}/entries`)).json(),
    );
    expect(page.entries.map((e) => e.id)).toEqual([second.entryId, first.entryId]);
    expect(page.entries[1]?.progress).toMatchObject({ position: 50 });
    expect(page.entries[1]?.thumbnailUrl).toBe(`/api/library/${first.entryId}/thumbnail`);
    expect((await send(carol, "GET", `/api/shared/${shareId}/entries`)).status).toBe(404);
  });

  it("an expired share disappears", async () => {
    const { shareId } = await sharedPlaylist(new Date(Date.now() - 1000).toISOString());
    expect((await withMe(bob)).some((x) => x.shareId === shareId)).toBe(false);
    expect((await send(bob, "GET", `/api/shared/${shareId}/entries`)).status).toBe(404);
  });

  it("Save as my playlist gives the recipient their own copy in order", async () => {
    const { first, second, shareId } = await sharedPlaylist();
    const res = await send(bob, "POST", `/api/shared/${shareId}/save`);
    expect(res.status).toBe(201);
    const copy = PlaylistDetail.parse(await res.json());
    expect(copy).toMatchObject({ kind: "manual", name: "Alice's picks", count: 2 });
    const page = LibraryPage.parse(
      await (await send(bob, "GET", `/api/library?playlist=${copy.id}`)).json(),
    );
    const owned = await t.db
      .selectFrom("library_entries")
      .select(["id", "rendition_id"])
      .where("user_id", "=", bob.userId)
      .where(
        "id",
        "in",
        page.entries.map((e) => e.id),
      )
      .execute();
    expect(owned).toHaveLength(2);
    expect(page.entries.map((e) => e.title)).toEqual(["Second", "First"]);
    expect(page.entries.map((e) => e.id)).not.toContain(first.entryId);
    expect(page.entries.map((e) => e.id)).not.toContain(second.entryId);
  });

  it("a shared video cannot be saved as a playlist", async () => {
    const e = await seedEntry(t.db, alice.userId);
    await send(alice, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "user", id: bob.userId }],
      expiresAt: null,
    });
    const share = (await withMe(bob)).find((x) => x.id === e.entryId);
    expect(share?.kind).toBe("entry");
    expect((await send(bob, "POST", `/api/shared/${share?.shareId ?? ""}/save`)).status).toBe(409);
    const page = LibraryPage.parse(
      await (await send(bob, "GET", `/api/shared/${share?.shareId ?? ""}/entries`)).json(),
    );
    expect(page.entries.map((x) => x.id)).toEqual([e.entryId]);
  });

  it("the directory lists enabled accounts and groups, without the caller", async () => {
    await t.db
      .updateTable("users")
      .set({ groups: JSON.stringify(["family"]) })
      .where("id", "=", carol.userId)
      .execute();
    const dave = await signedIn(t.db, { username: "shdave" });
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", dave.userId)
      .execute();
    const dir = Directory.parse(await (await send(alice, "GET", "/api/directory")).json());
    const names = dir.users.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(["shbob", "shcarol"]));
    expect(names).not.toContain("shalice");
    expect(names).not.toContain("shdave");
    expect(dir.groups).toEqual([{ name: "family", members: 1 }]);
  });
});
