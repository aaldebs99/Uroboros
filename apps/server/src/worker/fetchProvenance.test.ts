import { fixture, type Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { argsOf } from "../downloads/profiles.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

async function downloadScenario(): Promise<Scenario> {
  const transcript = JSON.parse(await fixture("download-clip.json")) as {
    stdout: string;
    stderr: string;
  };
  return {
    steps: [
      { writeFile: "clip.mp4", content: "media bytes" },
      { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
      { stdout: transcript.stdout },
      { stderr: transcript.stderr },
    ],
  };
}

async function subscriptionOf(userId: string, profileId: string): Promise<string> {
  const row = await t.db
    .insertInto("subscriptions")
    .values({
      user_id: userId,
      kind: "playlist",
      extractor: "youtube",
      source_id: "PLprov",
      title: "P",
      url: "https://www.youtube.com/playlist?list=PLprov",
      feeds: JSON.stringify([]),
      tabs: JSON.stringify([]),
      profile_id: profileId,
      interval_minutes: 360,
      backfill: "none",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("fetch provenance", () => {
  it("gives the library entry the subscription its download came from", async () => {
    const u = await signedIn(t.db, { username: "prov" });
    const profile = await seededDefault(t.db);
    const subscriptionId = await subscriptionOf(u.userId, profile.id);
    const videoId = "prov-1";
    const url = `http://127.0.0.1:18765/${videoId}.mp4`;
    await t.db.transaction().execute((tx) =>
      queueDownload(tx, {
        userId: u.userId,
        requestId: null,
        extractor: "Generic",
        videoId,
        url,
        title: videoId,
        profile,
        subscriptionId,
      }),
    );
    const { fetch_key: fetchKey } = await t.db
      .selectFrom("downloads")
      .select("fetch_key")
      .where("video_id", "=", videoId)
      .executeTakeFirstOrThrow();
    const data = {
      fetchKey,
      extractor: "generic",
      videoId,
      url,
      profileId: profile.id,
      profileName: profile.name,
      revision: profile.revision,
      args: argsOf(profile),
    };
    await fetchProcessor(
      await h.deps(await downloadScenario()),
      createCancelRegistry(),
    )({
      id: fetchKey,
      data,
      attemptsMade: 0,
      opts: { attempts: 3 },
    });
    const entry = await t.db
      .selectFrom("library_entries")
      .select("subscription_id")
      .where("user_id", "=", u.userId)
      .executeTakeFirstOrThrow();
    expect(entry.subscription_id).toBe(subscriptionId);
  });
});
