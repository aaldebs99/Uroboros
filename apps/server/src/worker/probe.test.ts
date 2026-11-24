import { fixture } from "@uroboros/ytdlp/testing";
import { YOUTUBE_SEARCH_RESULTS, type DownloadRequest } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { toRequest, youtubeSearchUrl } from "../downloads/requests.ts";
import { saveLogin } from "../siteLogins/store.ts";
import { probeProcessor } from "./probe.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let user: SignedIn;
const KEY = Buffer.alloc(32, 5);

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db);
  user = await signedIn(testDb.db, { username: "probe" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

async function request(
  url: string,
  intent: "download" | "subscribe" | "search" = "download",
): Promise<string> {
  const p = await seededDefault(testDb.db);
  const row = await testDb.db
    .insertInto("download_requests")
    .values({ user_id: user.userId, url, profile_id: p.id, intent })
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
    expect(await h.queues.download.get(d.fetch_key)).toBeDefined();
  });

  it("refuses a single video pasted to subscribe to, downloading nothing", async () => {
    const id = await request("https://www.youtube.com/watch?v=sub-1", "subscribe");
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] }));
    expect(await load(id)).toMatchObject({
      state: "failed",
      kind: "video",
      errorKind: "not_a_feed",
      errorMessage: "a single video, not a channel or playlist",
    });
    const queued = await testDb.db
      .selectFrom("downloads")
      .select("id")
      .where("request_id", "=", id)
      .execute();
    expect(queued).toEqual([]);
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

  it("builds a channel's tabs from the root listing's nested entries, in one capped listing", async () => {
    const base = "https://www.youtube.com/@LinusTechTips";
    const id = await request(base);
    const deps = await h.deps({
      steps: [{ stdout: await fixture("probe-channel-root-nested.json") }],
    });
    await probeProcessor({ ...deps, limits: { ...deps.limits, maxPlaylistEntries: 2 } })({
      data: { requestId: id },
    });
    const req = await load(id);
    expect(req).toMatchObject({ state: "choosing", kind: "channel" });
    expect(req.groups.map((g) => [g.name, g.ticked, g.entries.length, g.truncated])).toEqual([
      ["Videos", true, 2, true],
      ["Live", false, 2, true],
      ["Shorts", false, 2, true],
    ]);
    expect(req.groups[0]?.entries[0]).toMatchObject({ id: "qiLUvCt3k6g", extractor: "Youtube" });
    // The last (only) yt-dlp run was the root's, capped one past what the preview keeps: no tab
    // was listed again.
    const argv = await h.lastArgv();
    expect(argv.at(-1)).toBe(base);
    expect(argv).toContain("--playlist-items=1:3");
  });

  it("lists a YouTube search's top videos as one unticked group, recording no playlist", async () => {
    const url = youtubeSearchUrl("blender open movie");
    const id = await request(url, "search");
    await run(
      id,
      await h.deps({ steps: [{ stdout: await fixture("probe-youtube-search.json") }] }),
    );
    const req = await load(id);
    expect(req).toMatchObject({ state: "choosing", kind: "playlist", title: "blender open movie" });
    expect(req.groups.map((g) => [g.name, g.ticked, g.truncated, g.url])).toEqual([
      ["YouTube", false, false, url],
    ]);
    expect(req.groups[0]?.entries.map((e) => [e.id, e.extractor, e.uploader])).toEqual([
      ["WhWc3b3KhnY", "Youtube", "Blender Studio"],
      ["_cMxraX_5RE", "Youtube", "Blender Studio"],
      ["UXqq0ZvbOnk", "Youtube", "Blender Studio"],
    ]);
    const argv = await h.lastArgv();
    expect(argv.at(-1)).toBe(url);
    expect(argv).toContain(`--playlist-items=1:${String(YOUTUBE_SEARCH_RESULTS)}`);
    const row = await testDb.db
      .selectFrom("download_requests")
      .select(["source_extractor", "source_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ source_extractor: null, source_id: null });
  });

  it("records channel ids and tab URLs", async () => {
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
    expect((await load(id)).groups.map((g) => g.url)).toEqual([
      `${base}/videos`,
      `${base}/shorts`,
      `${base}/streams`,
    ]);
    const row = await testDb.db
      .selectFrom("download_requests")
      .select(["source_extractor", "source_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    // The videos' extractor, so the channel key matches the library's channel page.
    expect(row).toEqual({ source_extractor: "youtube", source_id: "UCSMOQeBJ2RAnuFungnQOxLg" });
  });

  it("names a single listing's group by the pasted URL", async () => {
    const url = "https://www.youtube.com/@BlenderOfficial/videos";
    const id = await request(url);
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-channel.json") }] }));
    expect((await load(id)).groups.map((g) => g.url)).toEqual([url]);
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

  it("names a login wall and keeps yt-dlp's own lines for the error's Details", async () => {
    const id = await request("https://vimeo.com/753580183");
    const line =
      "ERROR: [vimeo] 753580183: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.";
    await run(id, await h.deps({ steps: [{ stderr: `${line}\n` }], exitCode: 1 }));
    const req = await load(id);
    expect(req).toMatchObject({
      state: "failed",
      errorKind: "login_required",
      errorMessage: "the site needs a signed-in account",
    });
    expect(req.stderrTail).toContain(line);
  });

  it("signs in with the requester's saved logins only, and names a refused login", async () => {
    const other = await signedIn(testDb.db, { username: "probe-other" });
    await saveLogin(testDb.db, KEY, user.userId, "vimeo", { username: "me", password: "mine-pw" });
    await saveLogin(testDb.db, KEY, other.userId, "twitch", {
      username: "x",
      password: "their-pw",
    });
    const id = await request("https://vimeo.com/1");
    const deps = await h.deps({
      steps: [
        { copyArgFile: "--netrc-location", name: ".netrc", as: "netrc-seen" },
        { stderr: "ERROR: [vimeo] Unable to log in: bad username or password\n" },
      ],
      exitCode: 1,
    });
    await run(id, { ...deps, ytdlp: { ...deps.ytdlp, secretsKey: KEY } });
    expect(await load(id)).toMatchObject({
      state: "failed",
      errorKind: "login_failed",
      errorMessage: "the site refused the saved login",
    });
    expect(await h.lastCopied("netrc-seen")).toBe('machine vimeo login "me" password "mine-pw"\n');
  });

  it("runs without --netrc when the server has no key", async () => {
    const id = await request("https://vimeo.com/2");
    await run(id, await h.deps({ steps: [{ stdout: await fixture("probe-video.json") }] }));
    expect(await h.lastArgv()).not.toContain("--netrc");
  });
});
