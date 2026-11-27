import { fixture } from "@uroboros/ytdlp/testing";
import type { DownloadRequest } from "@uroboros/contract";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { listedNotices } from "../../test/notices.ts";
import { holdSite, loggedLimits, queuedPushes } from "../../test/rateLimits.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { activeCooldown } from "../downloads/rateLimits.ts";
import { toRequest } from "../downloads/requests.ts";
import { RequeueError } from "../jobs/errors.ts";
import { clearNotices } from "../notices/store.ts";
import { probeProcessor } from "./probe.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let user: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db);
  user = await signedIn(testDb.db, { username: "prl" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

async function request(
  url: string,
  intent: "download" | "search" = "download",
  userId = user.userId,
): Promise<string> {
  const p = await seededDefault(testDb.db);
  const row = await testDb.db
    .insertInto("download_requests")
    .values({ user_id: userId, url, profile_id: p.id, intent })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const load = async (id: string): Promise<DownloadRequest> =>
  toRequest(
    await testDb.db
      .selectFrom("download_requests")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow(),
  );

const run = async (id: string, deps: Awaited<ReturnType<typeof h.deps>>) =>
  probeProcessor(deps)({ data: { requestId: id } }).then(
    () => null,
    (e: unknown) => e,
  );

const LIMIT =
  "ERROR: [youtube] x: Video unavailable. This content isn't available, try again later. The " +
  "current session has been rate-limited by YouTube for up to an hour.\n";

describe("a probe the site rate-limits", () => {
  it("keeps looking at the link, waiting as long as the site says", async () => {
    const id = await request("https://prl1.example/watch?v=a");
    const err = await run(id, await h.deps({ steps: [{ stderr: LIMIT }], exitCode: 1 }));
    expect(err).toBeInstanceOf(RequeueError);
    expect((err as RequeueError).delayMs).toBeGreaterThanOrEqual(3_598_000);
    const req = await load(id);
    expect(req).toMatchObject({ state: "probing", errorKind: "rate_limited" });
    expect(req.retryAt).not.toBeNull();
    expect(await activeCooldown(testDb.db, "prl1.example", "site")).not.toBeNull();
  });

  it("asks nothing of a site that is cooling down", async () => {
    const id = await request("https://prl2.example/watch?v=a");
    await holdSite(testDb.db, "prl2.example");
    const deps = await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] });
    expect(await run(id, deps)).toBeInstanceOf(RequeueError);
    await expect(h.runs.at(-1)?.argv()).rejects.toThrow();
    expect(await load(id)).toMatchObject({ state: "probing", errorKind: "rate_limited" });
  });

  it("goes on once the site answers, the wait and the limits in a row forgotten", async () => {
    const id = await request("https://prl3.example/watch?v=a");
    await testDb.db
      .updateTable("download_requests")
      .set({ error_kind: "rate_limited", retry_at: sql`now() - interval '1 second'` })
      .where("id", "=", id)
      .execute();
    await testDb.db
      .insertInto("site_cooldowns")
      .values({
        site: "prl3.example",
        scope: "site",
        until: sql`now() - interval '1 second'`,
        strikes: 4,
      })
      .execute();
    const deps = await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] });
    expect(await run(id, deps)).toBeNull();
    expect(await load(id)).toMatchObject({ state: "queued", errorKind: null, retryAt: null });
    const left = await testDb.db
      .selectFrom("site_cooldowns")
      .select("site")
      .where("site", "=", "prl3.example")
      .execute();
    expect(left).toEqual([]);
  });
});

describe("what a probe's rate limit tells", () => {
  it("logs the limit, and tells the person once that their link waits", async () => {
    const someone = await signedIn(testDb.db, { username: "prl-told" });
    const url = "https://prl4.example/watch?v=a";
    const id = await request(url, "download", someone.userId);
    await run(id, await h.deps({ steps: [{ stderr: LIMIT }], exitCode: 1 }));
    expect(await loggedLimits(testDb.db, "prl4.example")).toEqual([
      expect.objectContaining({
        scope: "site",
        source: "link",
        url,
        title: null,
        hinted: true,
        strikes: 1,
        message: expect.stringContaining("rate-limited by YouTube for up to an hour") as string,
      }),
    ]);
    const told = {
      kind: "downloads",
      title: `Waiting: ${url}`,
      body: "prl4.example is limiting requests. It will try again on its own.",
      path: "/downloads",
      tag: `rate-limit:request:${id}`,
      read_at: null,
    };
    expect(await listedNotices(testDb.db, someone.userId)).toEqual([told]);
    expect(await queuedPushes(testDb.db, someone.userId)).toEqual([]);
    // The passes that wait out the cooldown tell nothing more, and log nothing.
    await run(id, await h.deps({ steps: [] }));
    expect(await listedNotices(testDb.db, someone.userId)).toEqual([told]);
    expect(await loggedLimits(testDb.db, "prl4.example")).toHaveLength(1);
  });

  it("tells no one again after they clear their bell while it still waits", async () => {
    const someone = await signedIn(testDb.db, { username: "prl-clear" });
    const id = await request("https://prl7.example/watch?v=a", "download", someone.userId);
    await run(id, await h.deps({ steps: [{ stderr: LIMIT }], exitCode: 1 }));
    expect(await listedNotices(testDb.db, someone.userId)).toHaveLength(1);
    await clearNotices(testDb.db, someone.userId);
    await run(id, await h.deps({ steps: [] }));
    expect(await listedNotices(testDb.db, someone.userId)).toEqual([]);
  });

  it("names a search by its query, logged as one", async () => {
    const someone = await signedIn(testDb.db, { username: "prl-search" });
    const url = "https://prl5.example/results?search_query=big+buck+bunny&sp=EgIQAQ%3D%3D";
    const id = await request(url, "search", someone.userId);
    await run(id, await h.deps({ steps: [{ stderr: LIMIT }], exitCode: 1 }));
    expect((await loggedLimits(testDb.db, "prl5.example")).map((r) => r.source)).toEqual([
      "search",
    ]);
    expect((await listedNotices(testDb.db, someone.userId)).map((n) => n.title)).toEqual([
      'Waiting: search for "big buck bunny"',
    ]);
  });

  it("tells the person whose link waits on a site already cooling down", async () => {
    const someone = await signedIn(testDb.db, { username: "prl-cool" });
    const id = await request("https://prl6.example/watch?v=a", "download", someone.userId);
    await holdSite(testDb.db, "prl6.example");
    await run(id, await h.deps({ steps: [] }));
    expect((await listedNotices(testDb.db, someone.userId)).map((n) => n.tag)).toEqual([
      `rate-limit:request:${id}`,
    ]);
  });
});
