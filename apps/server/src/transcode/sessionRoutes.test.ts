import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { PlaybackSession } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { testBus } from "../../test/bus.ts";
import { liveJobs } from "../../test/jobs.ts";
import type { PgBus } from "../db/notifications.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import {
  type BusMessage,
  createPlaybackBus,
  isAlive,
  markStored,
  type PlaybackBus,
} from "./bus.ts";
import { initKey, segmentKey } from "./sessions.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let pg: PgBus;
let bus: PlaybackBus;
let alice: SignedIn;
let bob: SignedIn;
let film: { entryId: string; renditionId: string };

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-sessions-")),
    layout: DEFAULT_LAYOUT,
  });
  pg = testBus(t);
  bus = createPlaybackBus(pg, t.db, logger);
  await bus.ready;
  alice = await signedIn(t.db, { username: "salice" });
  bob = await signedIn(t.db, { username: "sbob" });
  film = await seedEntry(t.db, alice.userId);
  await t.db
    .updateTable("renditions")
    .set({
      video_codec: "vp9",
      video_codecs: "vp09.00.40.08",
      audio_codec: "opus",
      audio_codecs: "opus",
      width: 1920,
      height: 1080,
      duration: 20,
    })
    .where("id", "=", film.renditionId)
    .execute();
});
afterAll(async () => {
  bus.close();
  await pg.close();
  await h.close();
  await t.close();
});

const app = (): OpenAPIHono =>
  createApp(
    {
      db: t.db,
      version: "t",
      logger,
      downloads: h.ctx,
      store,
      playbackBus: bus,
      playbackWaitMs: 1500,
    },
    { webDist: null },
  );
const as = (s: SignedIn) => asUser(app(), s);
const base = (entryId = film.entryId) => `/api/library/${entryId}/playback`;

async function create(s: SignedIn, body: Record<string, unknown> = {}, entryId = film.entryId) {
  return as(s).request(base(entryId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quality: "720", start: 0, copyVideo: false, copyAudio: true, ...body }),
  });
}

async function session(s: SignedIn = alice, body: Record<string, unknown> = {}) {
  const res = await create(s, body);
  expect(res.status).toBe(201);
  return PlaybackSession.parse(await res.json());
}

describe("creating a playback session", () => {
  it("plans it, queues its run and answers where it lives", async () => {
    const s = await session();
    expect(s).toMatchObject({
      state: "queued",
      mode: "encode",
      quality: "720",
      encoder: null,
      width: 1280,
      height: 720,
      // The seeded file is 10 bytes over 20 s, so the encode aims at the floor.
      bitrate: 500_000,
      reason: "picked",
      url: `${base()}/sessions/${s.id}`,
      masterUrl: `${base()}/sessions/${s.id}/master.m3u8`,
      error: null,
    });
    const jobs = await liveJobs(t.db, "playback");
    expect(jobs.map((j) => j.key)).toContain(`playback|${s.id}`);
    expect(await isAlive({ db: t.db }, s.id)).toBe(true);
  });

  it("encodes Original at the source's size, no taller than the server's maximum", async () => {
    const full = await session(alice, { quality: "original" });
    expect([full.width, full.height]).toEqual([1920, 1080]);
    const capped = asUser(
      createApp(
        {
          db: t.db,
          version: "t",
          logger,
          downloads: h.ctx,
          store,
          playbackBus: bus,
          transcodeMaxShort: 720,
        },
        { webDist: null },
      ),
      alice,
    );
    const res = await capped.request(base(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality: "original", start: 0, copyVideo: false, copyAudio: true }),
    });
    const s = PlaybackSession.parse(await res.json());
    expect([s.width, s.height]).toEqual([1280, 720]);
  });

  it("leaves the viewer's other sessions of the entry playing (another tab or device)", async () => {
    const first = await session();
    const stops: BusMessage[] = [];
    const off = bus.on((m) => {
      if (m.t === "stop") stops.push(m);
    });
    await session(alice, { quality: "480" });
    await new Promise((r) => setTimeout(r, 100));
    off();
    expect(stops).toEqual([]);
    const again = PlaybackSession.parse(await (await as(alice).request(first.url)).json());
    expect(again.state).toBe("queued");
  });

  it("is 404 for an entry the caller can't see, and for someone else's session", async () => {
    expect((await create(bob)).status).toBe(404);
    const s = await session();
    expect((await as(bob).request(s.url)).status).toBe(404);
    expect((await as(bob).request(s.masterUrl)).status).toBe(404);
  });

  it("refuses a video whose length is unknown (409)", async () => {
    const other = await seedEntry(t.db, alice.userId);
    await t.db
      .updateTable("media")
      .set({ duration: null })
      .where("id", "=", other.mediaId)
      .execute();
    expect((await create(alice, {}, other.entryId)).status).toBe(409);
  });
});

describe("a session's playlists", () => {
  it("states the variant's codecs and size, over the media playlist", async () => {
    const s = await session();
    const res = await as(alice).request(s.masterUrl);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    const text = await res.text();
    expect(text).toContain('CODECS="avc1.640020,opus",RESOLUTION=1280x720');
    expect(text).toContain("\nindex.m3u8\n");
  });

  it("lists the whole video at once, ended", async () => {
    const s = await session();
    const text = await (await as(alice).request(`${s.url}/index.m3u8`)).text();
    expect(text).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    // 20 s: three of 6 s and the last 2 s.
    expect(text.match(/#EXTINF/g)).toHaveLength(4);
    expect(text).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(text).toContain("#EXTINF:2.000000,\nseg-3.m4s\n#EXT-X-ENDLIST");
  });

  it("cuts a remux at the keyframes, once they are known (409 before)", async () => {
    const s = await session(alice, { quality: "original", copyVideo: true });
    expect(s.mode).toBe("remux");
    // A remux copies the video: no encode, no target bitrate.
    expect(s.bitrate).toBeNull();
    expect((await as(alice).request(`${s.url}/index.m3u8`)).status).toBe(409);
    await t.db
      .insertInto("rendition_keyframes")
      .values({ rendition_id: film.renditionId, times: [0, 4, 8, 12, 16] })
      .execute();
    const r = await session(alice, { quality: "original", copyVideo: true });
    const text = await (await as(alice).request(`${r.url}/index.m3u8`)).text();
    expect(text).toContain("#EXTINF:8.000000,\nseg-0.m4s\n#EXTINF:4.000000,\nseg-1.m4s");
    await t.db.deleteFrom("rendition_keyframes").execute();
  });
});

describe("a session's segments", () => {
  const keys = () => ({ db: t.db });

  it("streams a stored segment, cached for good", async () => {
    const s = await session();
    await store.putBytes(segmentKey(s.id, 0), Buffer.from("segment zero"), "video/mp4");
    await markStored(keys(), s.id, 0);
    const res = await as(alice).request(`${s.url}/seg-0.m4s`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("segment zero");
  });

  it("holds a request for a segment not made yet until the runner stores it", async () => {
    const s = await session();
    const off = bus.on((m) => {
      if (m.t === "want" && m.sid === s.id && m.n === -1) {
        void store
          .putBytes(initKey(s.id), Buffer.from("init"), "video/mp4")
          .then(() => markStored(keys(), s.id, -1))
          .then(() => bus.publish({ t: "ready", sid: s.id, n: -1 }));
      }
    });
    const res = await as(alice).request(`${s.url}/init.mp4`);
    off();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("init");
  });

  it("answers 503 when the segment takes too long, and 404 for no such segment", async () => {
    const s = await session();
    expect((await as(alice).request(`${s.url}/seg-1.m4s`)).status).toBe(503);
    expect((await as(alice).request(`${s.url}/seg-4.m4s`)).status).toBe(404);
    expect((await as(alice).request(`${s.url}/seg-x.m4s`)).status).toBe(404);
  });

  it("is gone once stopped", async () => {
    const s = await session();
    expect((await as(alice).request(s.url, { method: "DELETE" })).status).toBe(204);
    expect((await as(alice).request(`${s.url}/seg-0.m4s`)).status).toBe(404);
    expect((await as(alice).request(s.masterUrl)).status).toBe(404);
  });
});

describe("a public link's sessions", () => {
  async function link(code: string) {
    // One link per entry: a new one replaces the last.
    await t.db.deleteFrom("shares").where("entry_id", "=", film.entryId).execute();
    await t.db
      .insertInto("shares")
      .values({ owner_id: alice.userId, entry_id: film.entryId, mode: "link", code })
      .execute();
    return `/api/public/s/${code}/items/${film.entryId}/playback`;
  }
  const open = (path: string, body: Record<string, unknown> = {}) =>
    app().request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quality: "480",
        start: 0,
        copyVideo: false,
        copyAudio: true,
        ...body,
      }),
    });

  it("plays under the link, three screens at a time", async () => {
    const path = await link("pubcode00000000000000a");
    const first = PlaybackSession.parse(await (await open(path)).json());
    expect(first.url).toBe(`${path}/sessions/${first.id}`);
    // Each POST from a link is another screen: nobody is signed in to tell them apart.
    expect((await open(path)).status).toBe(201);
    expect((await open(path)).status).toBe(201);
    expect((await open(path)).status).toBe(429);
    expect((await app().request(first.masterUrl)).status).toBe(200);
  });

  it("answers the session, its playlist and a stored segment under the code, and stops it", async () => {
    const path = await link("pubcode00000000000000c");
    const s = PlaybackSession.parse(await (await open(path)).json());
    const got = await app().request(s.url);
    expect(got.status).toBe(200);
    expect(PlaybackSession.parse(await got.json()).id).toBe(s.id);
    const index = await app().request(`${s.url}/index.m3u8`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("#EXT-X-ENDLIST");
    await store.putBytes(segmentKey(s.id, 0), Buffer.from("segment zero"), "video/mp4");
    await markStored({ db: t.db }, s.id, 0);
    const seg = await app().request(`${s.url}/seg-0.m4s`);
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe("segment zero");
    // The same session under a code that was never made, or on the signed-in path, is nobody's.
    expect(
      (await app().request(s.url.replace("pubcode00000000000000c", "pubcode0000000000000zz")))
        .status,
    ).toBe(404);
    expect(
      (await app().request(`/api/library/${film.entryId}/playback/sessions/${s.id}`)).status,
    ).toBe(401);
    expect((await app().request(s.url, { method: "DELETE" })).status).toBe(204);
    expect((await app().request(`${s.url}/seg-0.m4s`)).status).toBe(404);
    expect((await app().request(s.masterUrl)).status).toBe(404);
  });

  it("stops working when the link is turned off", async () => {
    const path = await link("pubcode00000000000000b");
    const s = PlaybackSession.parse(await (await open(path)).json());
    await t.db.deleteFrom("shares").where("code", "=", "pubcode00000000000000b").execute();
    expect((await app().request(s.masterUrl)).status).toBe(404);
    expect((await open(path)).status).toBe(404);
  });
});
