import type { Scenario } from "@uroboros/ytdlp/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { listing } from "../../test/listings.ts";
import { listedNotices } from "../../test/notices.ts";
import { holdSite, loggedLimits } from "../../test/rateLimits.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { activeCooldown } from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import { checkProcessor } from "./check.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1000);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

let lastUser = "";

/**
 * A subscription to a channel on `site`, following its Videos tab (its person: `lastUser`); with
 * `uploadedAfter`, a filter only a full probe of each video can decide.
 */
async function subscription(site: string, uploadedAfter?: string): Promise<string> {
  const u = await signedIn(t.db, { username: `crl${String(++n)}` });
  lastUser = u.userId;
  const url = `https://${site}/@chan`;
  const feeds = JSON.stringify([{ name: "Videos", url: `${url}/videos` }]);
  const row = await t.db
    .insertInto("subscriptions")
    .values({
      user_id: u.userId,
      kind: "channel",
      extractor: "youtube",
      source_id: `UC-crl${String(n)}`,
      title: "Chan",
      url,
      feeds,
      tabs: feeds,
      profile_id: profileId,
      interval_minutes: 360,
      backfill: uploadedAfter === undefined ? "none" : "all",
      uploaded_after: uploadedAfter ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const check = async (id: string, scenario: Scenario) =>
  checkProcessor(await h.deps(scenario))({ data: { subscriptionId: id } }).then(
    () => null,
    (e: unknown) => e,
  );

const state = (id: string) =>
  t.db
    .selectFrom("subscriptions")
    .select(["failures", "lease_until", "last_error_kind"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("a subscription check the site rate-limits", () => {
  it("waits out the cooldown and checks again, counting no failure", async () => {
    const id = await subscription("crl1.example");
    const err = await check(id, {
      steps: [{ stderr: "ERROR: [youtube:tab] x: HTTP Error 429: Too Many Requests\n" }],
      exitCode: 1,
    });
    expect(err).toBeInstanceOf(RequeueError);
    expect((err as RequeueError).delayMs).toBeGreaterThanOrEqual(298_000);
    expect(await state(id)).toMatchObject({
      failures: 0,
      lease_until: null,
      last_error_kind: null,
    });
    expect(await activeCooldown(t.db, "crl1.example", "site")).not.toBeNull();
    // Logged for the admin as a check of the subscription; nobody's item waits, so no one is told.
    expect(await loggedLimits(t.db, "crl1.example")).toEqual([
      expect.objectContaining({
        source: "subscription",
        message: "[youtube:tab] x: HTTP Error 429: Too Many Requests",
        url: "https://crl1.example/@chan",
        title: "Chan",
      }),
    ]);
    expect(await listedNotices(t.db, lastUser)).toEqual([]);
  });

  it("waits out a limit on a video it probes for a filter, recording nothing", async () => {
    // The full probe is where YouTube's player answers; its captcha must pause the site rather
    // than leave the video "could not be checked" and go on to probe the next.
    const id = await subscription("crl4.example", "2026-11-01");
    const watch = "https://crl4.example/watch?v=c0";
    const captcha =
      "ERROR: [youtube] c0: This content isn't available, try again later. YouTube is requiring a captcha challenge before playback\n";
    const err = await check(id, {
      steps: [],
      variants: [
        {
          whenArg: "https://crl4.example/@chan/videos",
          steps: [
            { stdout: listing("https://crl4.example/@chan/videos", [{ id: "c0", url: watch }]) },
          ],
        },
        { whenArg: watch, steps: [{ stderr: captcha }], exitCode: 1 },
      ],
    });
    expect(err).toBeInstanceOf(RequeueError);
    expect(await activeCooldown(t.db, "crl4.example", "site")).not.toBeNull();
    expect(await loggedLimits(t.db, "crl4.example")).toEqual([
      expect.objectContaining({ source: "subscription", url: "https://crl4.example/@chan" }),
    ]);
    expect(await state(id)).toMatchObject({ failures: 0, lease_until: null });
    const recorded = await t.db
      .selectFrom("subscription_items")
      .select("video_id")
      .where("subscription_id", "=", id)
      .execute();
    expect(recorded).toEqual([]);
  });

  it("asks nothing of a site that is cooling down", async () => {
    const id = await subscription("crl2.example");
    await holdSite(t.db, "crl2.example", "site", 600_000);
    const err = await check(id, {
      steps: [{ stdout: listing("https://crl2.example/@chan/videos", []) }],
    });
    expect(err).toBeInstanceOf(RequeueError);
    expect((err as RequeueError).delayMs).toBeGreaterThan(590_000);
    await expect(h.runs.at(-1)?.argv()).rejects.toThrow();
    expect((await state(id)).lease_until).toBeNull();
  });

  it("forgets the limits in a row once the site answers", async () => {
    const id = await subscription("crl3.example");
    await t.db
      .insertInto("site_cooldowns")
      .values({
        site: "crl3.example",
        scope: "site",
        until: sql`now() - interval '1 second'`,
        strikes: 2,
      })
      .execute();
    expect(
      await check(id, { steps: [{ stdout: listing("https://crl3.example/@chan/videos", []) }] }),
    ).toBeNull();
    const left = await t.db
      .selectFrom("site_cooldowns")
      .select("site")
      .where("site", "=", "crl3.example")
      .execute();
    expect(left).toEqual([]);
  });
});
