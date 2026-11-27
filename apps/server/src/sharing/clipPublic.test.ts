import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ClipItem, PublicShare, ShareState } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedClip } from "../../test/clips.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { ogTags } from "./og.ts";

/**
 * A clip's public link (docs/sharing.md#clips): it plays and (allowed) saves the clip, and reaches
 * nothing else of the video it was cut from.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-cliplinks-")),
    layout: DEFAULT_LAYOUT,
  });
  alice = await signedIn(t.db, { username: "clalice" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const appFor = (clipsEnabled = true) =>
  createApp(
    { db: t.db, version: "t", logger, store, downloads: h.ctx },
    { webDist: null, clipsEnabled },
  );
const owner = (): OpenAPIHono => asUser(appFor(), alice);
const anyone = (clipsEnabled = true): OpenAPIHono => appFor(clipsEnabled);

/** A finished clip of Alice's, shared by a link; returns its code. */
async function linked(allowDownload: boolean) {
  const c = await seedClip(t.db, alice.userId, { title: "Holiday", done: { store } });
  const res = await owner().request(`/api/shares/clip/${c.exportId}/link`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowDownload, expiresAt: null }),
  });
  const code = ShareState.parse(await res.json()).link?.code ?? "";
  return { ...c, code };
}

describe("a clip's public link", () => {
  it("shows the clip, its range and length, with no description and nothing to save unless allowed", async () => {
    const { code, exportId } = await linked(false);
    const res = await anyone().request(`/api/public/s/${code}`);
    expect(res.status).toBe(200);
    const share = PublicShare.parse(await res.json());
    expect(share).toMatchObject({
      kind: "clip",
      title: "Holiday (clip 1:02–1:30)",
      description: null,
      allowDownload: false,
      items: [],
    });
    expect(ClipItem.parse(share.clip)).toMatchObject({
      id: exportId,
      range: { start: 62, end: 90 },
      duration: 28,
      state: "done",
      streamUrl: `/api/public/s/${code}/clip/stream`,
      fileUrl: null,
      owner: "clalice",
    });
  });

  it("plays the clip, and saves it only when the link allows downloads", async () => {
    const closed = await linked(false);
    const stream = await anyone().request(`/api/public/s/${closed.code}/clip/stream`);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toBe("clip bytes");
    expect((await anyone().request(`/api/public/s/${closed.code}/clip/file`)).status).toBe(404);
    const open = await linked(true);
    const file = await anyone().request(`/api/public/s/${open.code}/clip/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain(
      encodeURIComponent("(clip 1m02s–1m30s).mp4"),
    );
  });

  it("reaches nothing of the video it was cut from", async () => {
    const { code, entryId } = await linked(true);
    for (const path of ["", "/stream", "/file", "/thumbnail"]) {
      const res = await anyone().request(`/api/public/s/${code}/items/${entryId}${path}`);
      expect(res.status).toBe(404);
    }
  });

  it("is dead while clips are off, and once its owner is disabled", async () => {
    const { code } = await linked(false);
    expect((await anyone(false).request(`/api/public/s/${code}`)).status).toBe(404);
    expect((await anyone(false).request(`/api/public/s/${code}/clip/stream`)).status).toBe(404);
    const other = await signedIn(t.db, { username: "clgone" });
    const c = await seedClip(t.db, other.userId, { done: { store } });
    const res = await asUser(appFor(), other).request(`/api/shares/clip/${c.exportId}/link`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowDownload: false, expiresAt: null }),
    });
    const gone = ShareState.parse(await res.json()).link?.code ?? "";
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", other.userId)
      .execute();
    expect((await anyone().request(`/api/public/s/${gone}`)).status).toBe(404);
  });

  it("names the clip in a chat's preview", async () => {
    const { code } = await linked(false);
    const page = await ogTags(t.db, code, "https://uro.example");
    expect(page.title).toBe("Holiday (clip 1:02–1:30)");
    expect(page.tags).toContain('content="A 28 s clip on Uroboros"');
  });
});
