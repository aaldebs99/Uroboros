import type { OpenAPIHono } from "@hono/zod-openapi";
import { Preferences } from "@uroboros/contract";
import { sql } from "kysely";
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

/** The defaults' categories: those the default format profile used to skip. */
const D = ["interaction", "selfpromo", "sponsor"];
const SB_DEFAULT = { video: { show: D, skip: D }, audio: { show: D, skip: D } };

const patch = (s: SignedIn, body: unknown) =>
  app(s).request("/api/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("a person's preferences", () => {
  it("start at the defaults", async () => {
    expect(await read(alice)).toEqual({ hidePlaylistVideos: false, sponsorBlock: SB_DEFAULT });
  });

  it("save what a patch changes, answer them all, and stay the person's own", async () => {
    const res = await patch(alice, { hidePlaylistVideos: true });
    expect(res.status).toBe(200);
    expect(Preferences.parse(await res.json()).hidePlaylistVideos).toBe(true);
    expect((await read(alice)).hidePlaylistVideos).toBe(true);
    expect((await read(bob)).hidePlaylistVideos).toBe(false);
    // An empty patch changes nothing.
    expect(Preferences.parse(await (await patch(alice, {})).json()).hidePlaylistVideos).toBe(true);
    await patch(alice, { hidePlaylistVideos: false });
    expect((await read(alice)).hidePlaylistVideos).toBe(false);
  });

  it("refuse a value of the wrong kind (400)", async () => {
    expect((await patch(alice, { hidePlaylistVideos: "yes" })).status).toBe(400);
  });
});

describe("a person's SponsorBlock choices (docs/automation.md#sponsorblock)", () => {
  it("are the defaults until they choose: sponsor, self-promotion and interaction, shown and skipped", async () => {
    expect((await read(bob)).sponsorBlock).toEqual(SB_DEFAULT);
  });

  it("patch alone, sorted and de-duplicated, keeping hidePlaylistVideos", async () => {
    const carol = await signedIn(t.db, { username: "pfcarol" });
    await patch(carol, { hidePlaylistVideos: true });
    const res = await patch(carol, {
      sponsorBlock: {
        video: { show: ["sponsor", "intro", "sponsor"], skip: [] },
        audio: { show: D, skip: ["sponsor"] },
      },
    });
    expect(res.status).toBe(200);
    const want = {
      hidePlaylistVideos: true,
      sponsorBlock: {
        video: { show: ["intro", "sponsor"], skip: [] },
        audio: { show: D, skip: ["sponsor"] },
      },
    };
    expect(Preferences.parse(await res.json())).toEqual(want);
    expect(await read(carol)).toEqual(want);
    // Turning hidePlaylistVideos off leaves the SponsorBlock choices alone.
    await patch(carol, { hidePlaylistVideos: false });
    expect((await read(carol)).sponsorBlock).toEqual(want.sponsorBlock);
  });

  it("refuse a category SponsorBlock lacks (400)", async () => {
    const res = await patch(alice, {
      sponsorBlock: { video: { show: D, skip: ["poi_highlight"] }, audio: { show: D, skip: D } },
    });
    expect(res.status).toBe(400);
  });

  it("are held to the eight categories by the database too", async () => {
    await expect(
      sql`INSERT INTO user_preferences (user_id, sponsorblock_video_skip)
          VALUES (${bob.userId}, '{bogus}')`.execute(t.db),
    ).rejects.toThrow(/check constraint/);
  });
});
