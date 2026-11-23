import { fixture } from "@uroboros/ytdlp/testing";
import type { DownloadRequest } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { toRequest } from "../downloads/requests.ts";
import { probeProcessor } from "./probe.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let user: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db);
  user = await signedIn(testDb.db, { username: "probe" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

async function request(url: string): Promise<string> {
  const p = await seededDefault(testDb.db);
  const row = await testDb.db
    .insertInto("download_requests")
    .values({ user_id: user.userId, url, profile_id: p.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function load(id: string): Promise<DownloadRequest> {
  const row = await testDb.db
    .selectFrom("download_requests")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return toRequest(row);
}

const run = async (id: string, deps: Awaited<ReturnType<typeof h.deps>>) =>
  probeProcessor(deps)({ data: { requestId: id } });

describe("probe", () => {
  it("queues a video at once and dispatches it", async () => {
    const id = await request("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] }));
    expect(await load(id)).toMatchObject({ state: "queued", kind: "video" });
    const media = await testDb.db
      .selectFrom("media")
      .selectAll()
      .where("video_id", "=", "aqz-KE-bpKQ")
      .executeTakeFirstOrThrow();
    expect(media).toMatchObject({ extractor: "youtube", channel: "Blender" });
    const d = await testDb.db
      .selectFrom("downloads")
      .selectAll()
      .where("request_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(d.dispatched_at).not.toBeNull();
    expect(await h.queues.download.getJob(d.fetch_key)).toBeDefined();
  });

  it("has yt-dlp solve JavaScript challenges with Node", async () => {
    const id = await request("https://www.youtube.com/watch?v=js-1");
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] }));
    const argv = await h.lastArgv();
    expect(argv[argv.indexOf("--js-runtimes") + 1]).toBe("node:/usr/local/bin/node");
  });

  it("previews a playlist as one ticked group", async () => {
    const id = await request("https://www.youtube.com/playlist?list=x");
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-playlist.json") }] }));
    const req = await load(id);
    expect(req).toMatchObject({
      state: "choosing",
      kind: "playlist",
      title: "Blender Feature Demos",
    });
    expect(req.groups).toHaveLength(1);
    expect(req.groups[0]).toMatchObject({ ticked: true, truncated: false });
    expect(req.groups[0]?.entries[0]).toMatchObject({ extractor: "Youtube" });
    expect(req.groups[0]?.entries[0]?.url).toMatch(/^https:\/\//);
    const row = await testDb.db
      .selectFrom("download_requests")
      .select(["source_extractor", "source_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      source_extractor: "youtubetab",
      source_id: "PLa1F2ddGya_8NhFM-rx_xh5SlIGbHyrZZ",
    });
  });

  it("groups a channel's main URL by tab, with only Videos ticked", async () => {
    const base = "https://www.youtube.com/@BlenderOfficial";
    const id = await request(base);
    await run(
      id,
      await h.deps({
        steps: [{ stdout: await fixture("probe-channel-root.json") }],
        variants: [
          { whenArg: `${base}/videos`, steps: [{ stdout: await fixture("probe-channel.json") }] },
          { whenArg: `${base}/shorts`, steps: [{ stdout: await fixture("probe-playlist.json") }] },
          { whenArg: `${base}/streams`, steps: [{ stdout: await fixture("probe-playlist.json") }] },
        ],
      }),
    );
    const req = await load(id);
    expect(req).toMatchObject({ state: "choosing", kind: "channel" });
    expect(req.groups.map((g) => [g.name, g.ticked])).toEqual([
      ["Videos", true],
      ["Shorts", false],
      ["Live", false],
    ]);
    expect(req.groups[0]?.entries).toHaveLength(3);
  });

  it("cuts a long group at the entry limit, saying so", async () => {
    const id = await request("https://www.youtube.com/@BlenderOfficial/videos");
    const deps = await h.deps({ steps: [{ stdout: await fixture("probe-channel.json") }] });
    await probeProcessor({ ...deps, limits: { ...deps.limits, maxPlaylistEntries: 2 } })({
      data: { requestId: id },
    });
    const [group] = (await load(id)).groups;
    expect(group?.entries).toHaveLength(2);
    expect(group?.truncated).toBe(true);
  });

  it("marks the request failed with the error kind", async () => {
    const id = await request("https://www.youtube.com/watch?v=gone");
    const recorded = JSON.parse(await fixture("probe-unavailable.json")) as {
      stderr: string;
      exitCode: number;
    };
    await run(
      id,
      await h.deps({ steps: [{ stderr: recorded.stderr }], exitCode: recorded.exitCode }),
    );
    expect(await load(id)).toMatchObject({ state: "failed", errorKind: "unavailable" });
  });
});
