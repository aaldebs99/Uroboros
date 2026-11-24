import { UnrecoverableError } from "../jobs/errors.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadScenario, downloadStates, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { saveLogin } from "../siteLogins/store.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const user = (): Promise<SignedIn> => signedIn(testDb.db, { username: `fl${String(++n)}` });

describe("fetch with saved site logins", () => {
  it("signs a shared fetch in with, per site, the earliest waiter's saved login", async () => {
    const key = Buffer.alloc(32, 6);
    const [first, second] = [await user(), await user()];
    await saveLogin(testDb.db, key, first.userId, "vimeo", { username: "a", password: "first-pw" });
    await saveLogin(testDb.db, key, second.userId, "vimeo", { username: "b", password: "second" });
    await saveLogin(testDb.db, key, second.userId, "twitch", { username: "b", password: "tw-pw" });
    const data = await queuedFetch(testDb.db, "logins-1", [first, second]);
    const deps = await h.deps(
      await downloadScenario([{ copyArgFile: "--netrc-location", name: ".netrc", as: "seen" }]),
    );
    await fetchProcessor(
      { ...deps, ytdlp: { ...deps.ytdlp, secretsKey: key } },
      createCancelRegistry(),
    )(fetchJob(data));
    const seen = (await h.lastCopied("seen"))?.split("\n").filter(Boolean).sort();
    expect(seen).toEqual([
      'machine twitch login "b" password "tw-pw"',
      'machine vimeo login "a" password "first-pw"',
    ]);
    expect((await downloadStates(testDb.db, "logins-1")).map((s) => s.state)).toEqual([
      "done",
      "done",
    ]);
  });

  it("fails a refused login at once, without a retry", async () => {
    const data = await queuedFetch(testDb.db, "login-refused-1", [await user()]);
    const deps = await h.deps({
      steps: [{ stderr: "ERROR: [twitch:vod] Unable to login. Invalid username or password\n" }],
      exitCode: 1,
    });
    await expect(
      fetchProcessor(deps, createCancelRegistry())(fetchJob(data)),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const [s] = await downloadStates(testDb.db, "login-refused-1");
    expect(s).toMatchObject({ state: "failed", error_kind: "login_failed" });
  });
});
