import type { OpenAPIHono } from "@hono/zod-openapi";
import { Preferences } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "pfalice" });
  bob = await signedIn(t.db, { username: "pfbob" });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);

async function read(s: SignedIn): Promise<Preferences> {
  const res = await app(s).request("/api/me/preferences");
  expect(res.status).toBe(200);
  return Preferences.parse(await res.json());
}

const patch = (s: SignedIn, body: unknown) =>
  app(s).request("/api/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("a person's preferences", () => {
  it("start at the defaults", async () => {
    expect(await read(alice)).toEqual({ hidePlaylistVideos: false });
  });

  it("save what a patch changes, answer them all, and stay the person's own", async () => {
    const res = await patch(alice, { hidePlaylistVideos: true });
    expect(res.status).toBe(200);
    expect(Preferences.parse(await res.json())).toEqual({ hidePlaylistVideos: true });
    expect(await read(alice)).toEqual({ hidePlaylistVideos: true });
    expect(await read(bob)).toEqual({ hidePlaylistVideos: false });
    // An empty patch changes nothing.
    expect(Preferences.parse(await (await patch(alice, {})).json())).toEqual({
      hidePlaylistVideos: true,
    });
    await patch(alice, { hidePlaylistVideos: false });
    expect(await read(alice)).toEqual({ hidePlaylistVideos: false });
  });

  it("refuse a value of the wrong kind (400)", async () => {
    expect((await patch(alice, { hidePlaylistVideos: "yes" })).status).toBe(400);
  });
});
