import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { SubscriptionsTable } from "../db/schema.ts";
import { checkProcessor } from "./check.ts";
import { updateSubscription } from "./subscriptions.ts";
import type { Insertable } from "kysely";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1000);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const videos = "https://www.youtube.com/@BlenderOfficial/videos";
const watch = (v: string) => `https://www.youtube.com/watch?v=${v}`;
let n = 0;
const user = (): Promise<SignedIn> => signedIn(t.db, { username: `bf${String(++n)}` });

/** A full probe of one video, uploaded on `uploadDate` (YYYYMMDD). */
const video = (id: string, uploadDate: string) =>
  JSON.stringify({
    _type: "video",
    id,
    title: `Video ${id}`,
    duration: 300,
    upload_date: uploadDate,
    extractor_key: "Youtube",
    webpage_url: watch(id),
  });

async function sub(
  userId: string,
  opts: {
    backfill?: "none" | "all";
    primed?: boolean;
    columns?: Partial<Insertable<SubscriptionsTable>>;
  },
) {
  return insertSubscription(t.db, {
    userId,
    profileId,
    feeds: [
      {
        name: "Videos",
        url: videos,
        primedAt: opts.primed === true ? new Date().toISOString() : null,
      },
    ],
    sourceId: `BF${String(++n)}`,
    backfill: opts.backfill ?? "none",
    ...(opts.columns === undefined ? {} : { columns: opts.columns }),
  });
}

async function check(id: string, scenario: Scenario) {
  await checkProcessor(await h.deps(scenario))({ data: { subscriptionId: id } });
}

const downloads = (id: string) =>
  t.db
    .selectFrom("downloads")
    .select(["video_id", "priority"])
    .where("subscription_id", "=", id)
    .orderBy("video_id")
    .execute();

const items = (id: string) =>
  t.db
    .selectFrom("subscription_items")
    .select(["video_id", "outcome", "reason"])
    .where("subscription_id", "=", id)
    .orderBy("video_id")
    .execute();

async function notices(userId: string) {
  const jobs = await h.queues.notify.getJobs(["waiting", "delayed", "prioritized"]);
  return jobs.filter((j) => j.data.userId === userId);
}

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${String(i).padStart(2, "0")}` }));

describe("backfill decided after the first check", () => {
  it("keeps budget-deferred backfill at priority 1 without a notice", async () => {
    const u = await user();
    const id = await sub(u.userId, { backfill: "all", columns: { uploaded_after: "2026-01-01" } });
    const scenario = {
      steps: [{ stdout: video("any", "20261115") }],
      variants: [{ whenArg: videos, steps: [{ stdout: listing(videos, ids("d", 53)) }] }],
    };
    await check(id, scenario);
    const first = await items(id);
    expect(first.filter((i) => i.outcome === "queued")).toHaveLength(50);
    expect(first.filter((i) => i.outcome === "waiting").map((i) => i.reason)).toEqual([
      "not checked yet",
      "not checked yet",
      "not checked yet",
    ]);
    await check(id, scenario);
    const queued = await downloads(id);
    expect(queued).toHaveLength(53);
    expect(queued.every((d) => d.priority === 1)).toBe(true);
    expect(await notices(u.userId)).toEqual([]);
  }, 60_000);

  it("skips the wait for backfilled videos", async () => {
    const u = await user();
    const id = await sub(u.userId, { backfill: "all", columns: { delay_hours: 24 } });
    await check(id, { steps: [{ stdout: listing(videos, [{ id: "w0" }]) }] });
    expect(await downloads(id)).toEqual([{ video_id: "w0", priority: 1 }]);
  });

  it("re-decides held-back videos as backfill after a filter edit", async () => {
    const u = await user();
    const id = await sub(u.userId, { primed: true, columns: { min_duration_s: 600 } });
    const scenario = { steps: [{ stdout: listing(videos, [{ id: "h0", duration: 300 }]) }] };
    await check(id, scenario);
    expect(await items(id)).toEqual([{ video_id: "h0", outcome: "filtered", reason: "too short" }]);
    await updateSubscription(h.ctx, u.userId, id, {
      filters: {
        titleInclude: null,
        titleExclude: null,
        minDuration: null,
        maxDuration: null,
        uploadedAfter: null,
        excludeShorts: false,
        excludeLive: false,
      },
    });
    await check(id, scenario);
    expect(await downloads(id)).toEqual([{ video_id: "h0", priority: 1 }]);
    expect(await notices(u.userId)).toEqual([]);
  });
});

describe("probes are not spent twice", () => {
  it("records permanent probe failures as filtered", async () => {
    const u = await user();
    const id = await sub(u.userId, { primed: true, columns: { uploaded_after: "2026-01-01" } });
    await check(id, {
      steps: [],
      variants: [
        { whenArg: videos, steps: [{ stdout: listing(videos, [{ id: "a0" }, { id: "g0" }]) }] },
        {
          whenArg: watch("a0"),
          steps: [{ stderr: "ERROR: [youtube] a0: Sign in to confirm your age\n" }],
          exitCode: 1,
        },
        {
          whenArg: watch("g0"),
          steps: [
            {
              stderr:
                "ERROR: [youtube] g0: The uploader has not made this video available in your country\n",
            },
          ],
          exitCode: 1,
        },
      ],
    });
    expect(await items(id)).toEqual([
      { video_id: "a0", outcome: "filtered", reason: "age-restricted" },
      { video_id: "g0", outcome: "filtered", reason: "geo-blocked" },
    ]);
  });

  it("does not re-probe a video waiting for its delay", async () => {
    const u = await user();
    const id = await sub(u.userId, {
      primed: true,
      columns: { uploaded_after: "2026-01-01", delay_hours: 24 },
    });
    const listed = { whenArg: videos, steps: [{ stdout: listing(videos, [{ id: "p0" }]) }] };
    await check(id, {
      steps: [],
      variants: [listed, { whenArg: watch("p0"), steps: [{ stdout: video("p0", "20261115") }] }],
    });
    const [held] = await items(id);
    expect(held?.outcome).toBe("waiting");
    expect(held?.reason).toMatch(/^waiting until /);
    await check(id, {
      steps: [],
      variants: [
        listed,
        { whenArg: watch("p0"), steps: [{ stderr: "ERROR: probed again\n" }], exitCode: 1 },
      ],
    });
    expect(await items(id)).toEqual([held]);
    // The last yt-dlp run was the listing: the waiting video was not probed again.
    expect(await h.lastArgv()).not.toContain(watch("p0"));
  });
});
