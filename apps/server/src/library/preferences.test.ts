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
/** The SponsorBlock extension's own colors. */
const COLORS = {
  sponsor: "#00d400",
  intro: "#00ffff",
  outro: "#0202ed",
  selfpromo: "#ffff00",
  preview: "#008fd6",
  hook: "#395699",
  filler: "#7300ff",
  interaction: "#cc00ff",
  music_offtopic: "#ff9900",
  poi_highlight: "#ff1684",
};

const patch = (s: SignedIn, body: unknown) =>
  app(s).request("/api/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("a person's preferences", () => {
  it("start at the defaults", async () => {
    expect(await read(alice)).toEqual({
      hidePlaylistVideos: false,
      sponsorBlock: SB_DEFAULT,
      sponsorBlockColors: COLORS,
    });
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
      sponsorBlockColors: COLORS,
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

  it("take hooks and greetings like any other category", async () => {
    const dave = await signedIn(t.db, { username: "pfdave" });
    const res = await patch(dave, {
      sponsorBlock: { video: { show: ["hook"], skip: ["hook"] }, audio: { show: D, skip: D } },
    });
    expect(res.status).toBe(200);
    expect((await read(dave)).sponsorBlock.video).toEqual({ show: ["hook"], skip: ["hook"] });
  });

  it("are held to the nine categories by the database too", async () => {
    await expect(
      sql`INSERT INTO user_preferences (user_id, sponsorblock_video_skip)
          VALUES (${bob.userId}, '{bogus}')`.execute(t.db),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("a person's SponsorBlock colors (docs/automation.md#sponsorblock)", () => {
  const stored = async (s: SignedIn) =>
    (
      await t.db
        .selectFrom("user_preferences")
        .select("sponsorblock_colors")
        .where("user_id", "=", s.userId)
        .executeTakeFirstOrThrow()
    ).sponsorblock_colors;

  it("are the SponsorBlock extension's until they choose", async () => {
    expect((await read(bob)).sponsorBlockColors).toEqual(COLORS);
  });

  it("patch alone, lower-cased, keeping only the changed ones, and reset to SponsorBlock's", async () => {
    const erin = await signedIn(t.db, { username: "pferin" });
    await patch(erin, { hidePlaylistVideos: true });
    const res = await patch(erin, {
      sponsorBlockColors: { ...COLORS, sponsor: "#FF0000", poi_highlight: "#00Aa00" },
    });
    expect(res.status).toBe(200);
    const want = { ...COLORS, sponsor: "#ff0000", poi_highlight: "#00aa00" };
    expect(Preferences.parse(await res.json()).sponsorBlockColors).toEqual(want);
    expect(await read(erin)).toMatchObject({ hidePlaylistVideos: true, sponsorBlockColors: want });
    expect(await stored(erin)).toEqual({ sponsor: "#ff0000", poi_highlight: "#00aa00" });
    // Back to SponsorBlock's: nothing left to keep.
    await patch(erin, { sponsorBlockColors: COLORS });
    expect(await stored(erin)).toEqual({});
    expect((await read(erin)).sponsorBlockColors).toEqual(COLORS);
  });

  it("refuse a color that isn't #rrggbb, and a missing one (400)", async () => {
    for (const bad of ["red", "#ff00", "#gg0000", "ff0000"]) {
      expect((await patch(alice, { sponsorBlockColors: { ...COLORS, sponsor: bad } })).status).toBe(
        400,
      );
    }
    const { hook: _hook, ...missing } = COLORS;
    expect((await patch(alice, { sponsorBlockColors: missing })).status).toBe(400);
  });

  it("read a stored color they can't use as SponsorBlock's", async () => {
    const frank = await signedIn(t.db, { username: "pffrank" });
    await t.db
      .insertInto("user_preferences")
      .values({
        user_id: frank.userId,
        sponsorblock_colors: JSON.stringify({
          sponsor: "nope",
          intro: "#123456",
          bogus: "#000000",
        }),
      })
      .execute();
    expect((await read(frank)).sponsorBlockColors).toEqual({ ...COLORS, intro: "#123456" });
  });
});
