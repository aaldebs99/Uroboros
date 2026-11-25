import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryPage } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let alice: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await signedIn(testDb.db, { username: "kdalice" });
  // A seeded rendition has no video stream: Alice's song stays sound only, her talk gets a picture.
  await seedEntry(testDb.db, alice.userId, { videoId: "kd-a", title: "Song of the week" });
  const talk = await seedEntry(testDb.db, alice.userId, {
    videoId: "kd-v",
    title: "Talk of the week",
  });
  await testDb.db
    .updateTable("renditions")
    .set({ video_codec: "h264" })
    .where("id", "=", talk.renditionId)
    .execute();
});
afterAll(async () => {
  await testDb.close();
});

const app = (): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), alice);

async function titles(query: string): Promise<string[]> {
  const res = await app().request(`/api/library${query}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json())
    .entries.map((e) => e.title)
    .sort();
}

describe("GET /api/library?kind", () => {
  it("keeps only the files with no picture with audio", async () => {
    expect(await titles("?kind=audio")).toEqual(["Song of the week"]);
  });

  it("keeps only the files with a picture with video", async () => {
    expect(await titles("?kind=video")).toEqual(["Talk of the week"]);
  });

  it("lists both without it", async () => {
    expect(await titles("")).toEqual(["Song of the week", "Talk of the week"]);
  });

  it("narrows a search the same way", async () => {
    expect(await titles("?q=week")).toEqual(["Song of the week", "Talk of the week"]);
    expect(await titles("?q=week&kind=audio")).toEqual(["Song of the week"]);
  });

  it("refuses anything but video or audio (400)", async () => {
    expect((await app().request("/api/library?kind=music")).status).toBe(400);
  });
});
