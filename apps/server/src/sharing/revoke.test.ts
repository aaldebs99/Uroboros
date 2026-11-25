import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ShareState } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

/**
 * Taking a share back, end to end through the routes an owner uses: what the recipient or a link
 * holder could reach before is gone after, on every route that serves the entry.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-revoke-")),
    layout: DEFAULT_LAYOUT,
  });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const appFor = () =>
  createApp({ db: t.db, version: "t", logger, downloads: h.ctx, store }, { webDist: null });
const app = (s: SignedIn): OpenAPIHono => asUser(appFor(), s);
const anon = (path: string) => appFor().request(path);
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

/** How the owner's entry is shared now. */
const stateOf = async (owner: SignedIn, entryId: string) =>
  ShareState.parse(await (await send(owner, "GET", `/api/shares/entry/${entryId}`)).json());

/** An owner, a recipient, and a stored film with a thumbnail and a subtitle. */
async function setting(): Promise<{
  owner: SignedIn;
  friend: SignedIn;
  film: SeededEntry;
  subId: string;
}> {
  n++;
  const owner = await signedIn(t.db, { username: `rvowner${String(n)}` });
  const friend = await signedIn(t.db, { username: `rvfriend${String(n)}` });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-revoke-src-")), "f");
  await writeFile(src, "0123456789");
  const key = `revoke${String(n)}`;
  await store.put(`${key}.mp4`, src, "video/mp4");
  await store.put(`${key}.jpg`, src, "image/jpeg");
  await store.put(`${key}.vtt`, src, "text/vtt");
  const film = await seedEntry(t.db, owner.userId, { storageKey: `${key}.mp4` });
  await t.db
    .updateTable("media")
    .set({ thumbnail_key: `${key}.jpg` })
    .where("id", "=", film.mediaId)
    .execute();
  const sub = await t.db
    .insertInto("subtitles")
    .values({ media_id: film.mediaId, lang: "en", storage_key: `${key}.vtt` })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { owner, friend, film, subId: sub.id };
}

describe("taking a share with people back", () => {
  /** What the recipient's every entry route answers. */
  const reach = async (friend: SignedIn, entryId: string, subId: string) =>
    Promise.all(
      ["", "/stream", "/thumbnail", `/subtitles/${subId}`].map(
        async (path) => (await send(friend, "GET", `/api/library/${entryId}${path}`)).status,
      ),
    );

  it("stops the recipient's access when the owner stops sharing with people", async () => {
    const { owner, friend, film, subId } = await setting();
    const shared = await send(owner, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [{ kind: "user", id: friend.userId }],
      expiresAt: null,
    });
    expect(shared.status).toBe(200);
    expect(await reach(friend, film.entryId, subId)).toEqual([200, 200, 200, 200]);

    const stopped = await send(owner, "DELETE", `/api/shares/entry/${film.entryId}/people`);
    expect(stopped.status).toBe(204);
    expect((await stateOf(owner, film.entryId)).people).toBeNull();
    expect(await reach(friend, film.entryId, subId)).toEqual([404, 404, 404, 404]);
    // The owner keeps it.
    expect((await send(owner, "GET", `/api/library/${film.entryId}`)).status).toBe(200);
  });

  it("stops it too when the owner saves an empty list of people", async () => {
    const { owner, friend, film, subId } = await setting();
    await send(owner, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [{ kind: "user", id: friend.userId }],
      expiresAt: null,
    });
    expect((await send(friend, "GET", `/api/library/${film.entryId}`)).status).toBe(200);
    const emptied = await send(owner, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [],
      expiresAt: null,
    });
    expect(emptied.status).toBe(200);
    expect(await reach(friend, film.entryId, subId)).toEqual([404, 404, 404, 404]);
  });

  it("refuses to stop another person's share", async () => {
    const { owner, friend, film } = await setting();
    await send(owner, "PUT", `/api/shares/entry/${film.entryId}/people`, {
      people: [{ kind: "user", id: friend.userId }],
      expiresAt: null,
    });
    expect((await send(friend, "DELETE", `/api/shares/entry/${film.entryId}/people`)).status).toBe(
      404,
    );
    expect((await send(friend, "GET", `/api/library/${film.entryId}`)).status).toBe(200);
  });
});

describe("turning a public link off", () => {
  it("kills the old code on every public route", async () => {
    const { owner, friend, film, subId } = await setting();
    const made = await send(owner, "PUT", `/api/shares/entry/${film.entryId}/link`, {
      allowDownload: true,
      expiresAt: null,
    });
    expect(made.status).toBe(200);
    const code = ShareState.parse(await made.json()).link?.code ?? "";
    const item = `/api/public/s/${code}/items/${film.entryId}`;
    const routes = [
      `/api/public/s/${code}`,
      item,
      `${item}/stream`,
      `${item}/file`,
      `${item}/thumbnail`,
      `${item}/subtitles/${subId}`,
    ];
    const statuses = () => Promise.all(routes.map(async (r) => (await anon(r)).status));
    expect(await statuses()).toEqual([200, 200, 200, 200, 200, 200]);

    // Nobody but the owner can turn it off.
    expect((await send(friend, "DELETE", `/api/shares/entry/${film.entryId}/link`)).status).toBe(
      404,
    );
    expect(await statuses()).toEqual([200, 200, 200, 200, 200, 200]);

    const off = await send(owner, "DELETE", `/api/shares/entry/${film.entryId}/link`);
    expect(off.status).toBe(204);
    expect((await stateOf(owner, film.entryId)).link).toBeNull();
    expect(await statuses()).toEqual([404, 404, 404, 404, 404, 404]);
  });

  it("a new link's code is not the old one, and the old one stays dead", async () => {
    const { owner, film } = await setting();
    const make = async () =>
      ShareState.parse(
        await (
          await send(owner, "PUT", `/api/shares/entry/${film.entryId}/link`, {
            allowDownload: false,
            expiresAt: null,
          })
        ).json(),
      ).link?.code ?? "";
    const first = await make();
    await send(owner, "DELETE", `/api/shares/entry/${film.entryId}/link`);
    const second = await make();
    expect(second).not.toBe(first);
    expect((await anon(`/api/public/s/${first}`)).status).toBe(404);
    expect((await anon(`/api/public/s/${second}`)).status).toBe(200);
  });
});

describe("a public link's files", () => {
  it("serves the linked entry's thumbnail and subtitles, and no other media's subtitle", async () => {
    const { owner, film, subId } = await setting();
    const other = await setting();
    const made = await send(owner, "PUT", `/api/shares/entry/${film.entryId}/link`, {
      allowDownload: false,
      expiresAt: null,
    });
    const code = ShareState.parse(await made.json()).link?.code ?? "";
    const item = `/api/public/s/${code}/items/${film.entryId}`;
    const thumb = await anon(`${item}/thumbnail`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    const sub = await anon(`${item}/subtitles/${subId}`);
    expect(sub.status).toBe(200);
    expect(sub.headers.get("content-type")).toMatch(/^text\/vtt/);
    // A valid link, but someone else's subtitle id: the link reaches its own media only.
    expect((await anon(`${item}/subtitles/${other.subId}`)).status).toBe(404);
    // And not another entry under this code.
    expect((await anon(`/api/public/s/${code}/items/${other.film.entryId}/thumbnail`)).status).toBe(
      404,
    );
    // Downloads were not offered.
    expect((await anon(`${item}/file`)).status).toBe(404);
  });

  it("answers 404 for an entry with no thumbnail", async () => {
    const { owner, film } = await setting();
    await t.db
      .updateTable("media")
      .set({ thumbnail_key: null })
      .where("id", "=", film.mediaId)
      .execute();
    const made = await send(owner, "PUT", `/api/shares/entry/${film.entryId}/link`, {
      allowDownload: false,
      expiresAt: null,
    });
    const code = ShareState.parse(await made.json()).link?.code ?? "";
    expect((await anon(`/api/public/s/${code}/items/${film.entryId}/thumbnail`)).status).toBe(404);
  });
});
