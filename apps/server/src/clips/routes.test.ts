import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipItem } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedClip } from "../../test/clips.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

/** A clip shared with people (docs/sharing.md#clips): theirs to play and save, and nothing more. */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-clipview-")),
    layout: DEFAULT_LAYOUT,
  });
  alice = await signedIn(t.db, { username: "cralice" });
  bob = await signedIn(t.db, { username: "crbob" });
  carol = await signedIn(t.db, { username: "crcarol" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn, clipsEnabled = true) =>
  asUser(
    createApp(
      { db: t.db, version: "t", logger, store, downloads: h.ctx },
      { webDist: null, clipsEnabled },
    ),
    s,
  );

/** A finished clip of Alice's shared with Bob. */
async function sharedWithBob() {
  const c = await seedClip(t.db, alice.userId, { title: "Holiday", done: { store } });
  await app(alice).request(`/api/shares/clip/${c.exportId}/people`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ people: [{ kind: "user", id: bob.userId }], expiresAt: null }),
  });
  return c;
}

describe("a clip shared with people", () => {
  it("is its owner's to see, and the people it reaches, who see who shared it", async () => {
    const c = await sharedWithBob();
    const own = ClipItem.parse(await (await app(alice).request(`/api/clips/${c.exportId}`)).json());
    expect(own).toMatchObject({ owner: null, title: "Holiday (clip 1:02–1:30)", duration: 28 });
    const res = await app(bob).request(`/api/clips/${c.exportId}`);
    expect(res.status).toBe(200);
    expect(ClipItem.parse(await res.json())).toMatchObject({
      owner: "cralice",
      streamUrl: `/api/clips/${c.exportId}/stream`,
      fileUrl: `/api/clips/${c.exportId}/file`,
    });
    const stream = await app(bob).request(`/api/clips/${c.exportId}/stream`);
    expect(await stream.text()).toBe("clip bytes");
    expect((await app(bob).request(`/api/clips/${c.exportId}/file`)).status).toBe(200);
  });

  it("reaches nobody else, and never the video it was cut from", async () => {
    const c = await sharedWithBob();
    expect((await app(carol).request(`/api/clips/${c.exportId}`)).status).toBe(404);
    expect((await app(carol).request(`/api/clips/${c.exportId}/stream`)).status).toBe(404);
    expect((await app(bob).request(`/api/library/${c.entryId}`)).status).toBe(404);
    expect((await app(bob).request(`/api/library/${c.entryId}/stream`)).status).toBe(404);
  });

  it("is out of reach while clips are off", async () => {
    const c = await sharedWithBob();
    expect((await app(bob, false).request(`/api/clips/${c.exportId}`)).status).toBe(404);
  });
});
