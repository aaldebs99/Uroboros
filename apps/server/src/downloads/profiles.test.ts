import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, FormatProfile } from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { argsOf, profileRevision, shiftsTimeline, ytdlpArgsFor } from "./profiles.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let admin: SignedIn;
let member: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  admin = await signedIn(testDb.db, { username: "padmin", role: "admin" });
  member = await signedIn(testDb.db, { username: "pmember" });
});
afterAll(async () => {
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger }, { webDist: null }), s);

const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

async function list(s: SignedIn = member): Promise<FormatProfile[]> {
  return z.array(FormatProfile).parse(await (await send(s, "GET", "/api/format-profiles")).json());
}

async function create(over: Record<string, unknown> = {}, s: SignedIn = member) {
  return send(s, "POST", "/api/format-profiles", {
    name: `p-${randomUUID().slice(0, 8)}`,
    format: "bv*+ba/b",
    ...over,
  });
}

const patch = (id: string, json: unknown, s: SignedIn = member) =>
  send(s, "PATCH", `/api/format-profiles/${id}`, json);

describe("format profiles", () => {
  it("seeds the six built-ins, whose revisions profileRevision reproduces, listed for everyone", async () => {
    const builtIns = (await list()).filter((p) => p.builtIn);
    expect(builtIns.map((p) => p.name)).toEqual([
      "Audio only (Opus)",
      "Best available",
      "Best up to 1080p (MP4)",
      "Music (MP3)",
      "Podcasts (M4A)",
      "Up to 720p (MP4)",
    ]);
    for (const p of builtIns) expect(p.revision).toBe(profileRevision(p));
    expect((await list(admin)).filter((p) => p.builtIn)).toEqual(builtIns);
  });

  it("sets the built-in video profiles to AV1 in MP4, at the heights their names say", async () => {
    const video = (await list())
      .filter((p) => p.builtIn && !p.audioOnly)
      .map((p) => [p.name, p.format, p.mergeFormat, p.videoCodec]);
    expect(video).toEqual([
      ["Best available", "bv*+ba/b", "mp4", "av1"],
      ["Best up to 1080p (MP4)", "bv*[height<=1080]+ba/b[height<=1080]", "mp4", "av1"],
      ["Up to 720p (MP4)", "bv*[height<=720]+ba/b[height<=720]", "mp4", "av1"],
    ]);
    const audio = (await list()).filter((p) => p.builtIn && p.audioOnly);
    for (const p of audio) expect(p.videoCodec).toBeNull();
  });

  it("takes stereo first in the built-in audio profiles, and Opus as the site serves it", async () => {
    // yt-dlp ranks channels above the codec, so a bare `ba/b` takes a 5.1 track where one is
    // offered (YouTube's AAC 5.1), converting it for Opus and MP3.
    const audio = (await list())
      .filter((p) => p.builtIn && p.audioOnly)
      .map((p) => [p.name, p.format, p.audioFormat]);
    expect(audio).toEqual([
      ["Audio only (Opus)", "ba[acodec=opus]/ba[audio_channels<=2]/ba/b", "opus"],
      ["Music (MP3)", "ba[audio_channels<=2]/ba/b", "mp3"],
      ["Podcasts (M4A)", "ba[ext=m4a][audio_channels<=2]/ba[ext=m4a]/ba/b", "m4a"],
    ]);
  });

  it("keeps a video codec, and refuses one an audio-only profile or WebM can't take", async () => {
    const p = FormatProfile.parse(
      await (await create({ videoCodec: "vp9", mergeFormat: "webm" })).json(),
    );
    expect([p.videoCodec, p.mergeFormat]).toEqual(["vp9", "webm"]);
    const renamed = FormatProfile.parse(await (await patch(p.id, { name: `${p.name}-2` })).json());
    expect(renamed.videoCodec).toBe("vp9");
    const anyCodec = FormatProfile.parse(await (await patch(p.id, { videoCodec: null })).json());
    expect(anyCodec.videoCodec).toBeNull();
    expect(anyCodec.revision).not.toBe(p.revision);
    const audio = await create({ audioOnly: true, audioFormat: "mp3", videoCodec: "av1" });
    expect(audio.status).toBe(400);
    for (const videoCodec of ["h264", "h265"]) {
      const res = await create({ videoCodec, mergeFormat: "webm" });
      expect([videoCodec, res.status]).toEqual([videoCodec, 400]);
      expect(ApiErrorBody.parse(await res.json()).message).toMatch(/WebM/);
    }
    expect((await patch(p.id, { videoCodec: "h264" })).status).toBe(400);
  });

  it("keeps the codec when a person edits a built-in into a profile of their own", async () => {
    const someone = await signedIn(testDb.db, { username: `p-${randomUUID().slice(0, 8)}` });
    const best = (await list(someone)).find((p) => p.name === "Best available");
    expect(best?.videoCodec).toBe("av1");
    if (best === undefined) return;
    const copy = FormatProfile.parse(
      await (await patch(best.id, { name: "My best" }, someone)).json(),
    );
    expect([copy.builtIn, copy.videoCodec, copy.mergeFormat]).toEqual([false, "av1", "mp4"]);
  });

  it("refuses an extra argument that is not allowed, naming it", async () => {
    const res = await create({ extraArgs: ["--exec", "x"] });
    expect(res.status).toBe(400);
    const body = ApiErrorBody.parse(await res.json());
    expect(body.code).toBe("bad_request");
    expect(body.message).toMatch(/--exec/);
  });

  it("refuses an audio-only profile without an audio format", async () => {
    expect((await create({ audioOnly: true })).status).toBe(400);
  });

  it("changes the revision when the format changes, not when only the name does", async () => {
    const p = FormatProfile.parse(await (await create()).json());
    expect(p.builtIn).toBe(false);
    const renamed = FormatProfile.parse(await (await patch(p.id, { name: `${p.name}-2` })).json());
    expect(renamed.revision).toBe(p.revision);
    const reformatted = FormatProfile.parse(await (await patch(p.id, { format: "b" })).json());
    expect(reformatted.revision).not.toBe(p.revision);
  });

  it("carries no SponsorBlock categories: each person's setting decides (Settings › SponsorBlock)", async () => {
    const p = FormatProfile.parse(await (await create({ sponsorblockRemove: ["sponsor"] })).json());
    expect(p).not.toHaveProperty("sponsorblockRemove");
  });

  it("refuses deleting a profile in use, and deletes an unused one", async () => {
    const used = FormatProfile.parse(await (await create()).json());
    const media = await testDb.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: randomUUID() })
      .returning("id")
      .executeTakeFirstOrThrow();
    const r = await testDb.db
      .insertInto("renditions")
      .values({
        media_id: media.id,
        profile_id: used.id,
        profile_revision: used.revision,
        storage_key: `k/${randomUUID()}`,
        size_bytes: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("library_entries")
      .values({ user_id: member.userId, media_id: media.id, rendition_id: r.id })
      .execute();
    expect((await send(member, "DELETE", `/api/format-profiles/${used.id}`)).status).toBe(409);
    const unused = FormatProfile.parse(await (await create()).json());
    expect((await send(member, "DELETE", `/api/format-profiles/${unused.id}`)).status).toBe(204);
  });

  it("refuses a built-in's name or one the person already used (409); two people may share one", async () => {
    expect((await create({ name: "Best available" })).status).toBe(409);
    expect((await create({ name: "Mine" })).status).toBe(201);
    expect((await create({ name: "Mine" })).status).toBe(409);
    expect((await create({ name: "Mine" }, admin)).status).toBe(201);
    const other = FormatProfile.parse(await (await create()).json());
    expect((await patch(other.id, { name: "Mine" })).status).toBe(409);
    expect((await patch(other.id, { name: "Audio only (Opus)" })).status).toBe(409);
  });
});

describe("profileRevision", () => {
  const best = {
    format: "bv*+ba/b",
    mergeFormat: null,
    audioOnly: false,
    audioFormat: null,
    extraArgs: [],
  };

  it("is the same as before codecs for a profile without one, so its files are still shared", () => {
    // The literal the first schema seeded "Best available" with.
    expect(profileRevision(best)).toBe("9dbd9d2454da");
    expect(profileRevision({ ...best, videoCodec: null })).toBe("9dbd9d2454da");
  });

  it("changes with the codec", () => {
    const av1 = profileRevision({ ...best, videoCodec: "av1" });
    expect(av1).not.toBe("9dbd9d2454da");
    expect(profileRevision({ ...best, videoCodec: "vp9" })).not.toBe(av1);
  });
});

describe("shiftsTimeline", () => {
  it("sees --sponsorblock-remove, --remove-chapters and --download-sections, joined or spaced", () => {
    expect(shiftsTimeline(["--sponsorblock-remove=sponsor"])).toBe(true);
    expect(shiftsTimeline(["--sponsorblock-remove", "all"])).toBe(true);
    expect(shiftsTimeline(["--remove-chapters", "Intro"])).toBe(true);
    expect(shiftsTimeline(["--embed-metadata", "--download-sections=*10-20"])).toBe(true);
  });

  it("leaves arguments that keep the file's times alone", () => {
    expect(shiftsTimeline([])).toBe(false);
    expect(shiftsTimeline(["--embed-chapters", "--sponsorblock-mark=all"])).toBe(false);
    expect(shiftsTimeline(["--sponsorblock-remove-later"])).toBe(false);
  });
});

describe("ytdlpArgsFor", () => {
  it("runs the Music built-in as best-quality MP3 with its cover", async () => {
    const music = (await list()).find((p) => p.name === "Music (MP3)");
    expect(music).toBeDefined();
    if (music === undefined) return;
    expect(ytdlpArgsFor(music)).toEqual({
      format: "ba[audio_channels<=2]/ba/b",
      extraArgs: [
        "--extract-audio",
        "--audio-format=mp3",
        "--write-thumbnail",
        "--convert-thumbnails=jpg",
        "--audio-quality=0",
        "--embed-metadata",
        "--embed-thumbnail",
      ],
    });
  });

  it("extracts audio, writes a jpg thumbnail, and keeps the profile's own arguments last", () => {
    expect(
      ytdlpArgsFor({
        format: "ba/b",
        mergeFormat: null,
        audioOnly: true,
        audioFormat: "opus",
        extraArgs: [],
      }),
    ).toEqual({
      format: "ba/b",
      extraArgs: [
        "--extract-audio",
        "--audio-format=opus",
        "--write-thumbnail",
        "--convert-thumbnails=jpg",
      ],
    });
    expect(
      ytdlpArgsFor({
        format: "b",
        mergeFormat: "mp4",
        audioOnly: false,
        audioFormat: null,
        extraArgs: ["--embed-chapters"],
      }).extraArgs,
    ).toEqual([
      "--merge-output-format=mp4",
      "--format-sort=lang,quality,res,fps,hdr:12,vcodec,channels,acodec:aac",
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
      "--embed-chapters",
    ]);
  });

  /** A video profile's arguments before the thumbnail ones, with `over` changed. */
  const shape = (over: Partial<Parameters<typeof ytdlpArgsFor>[0]>) =>
    ytdlpArgsFor({
      format: "bv*+ba/b",
      mergeFormat: null,
      audioOnly: false,
      audioFormat: null,
      extraArgs: [],
      ...over,
    }).extraArgs.filter((a) => !a.includes("thumbnail"));

  it("prefers the codec at the same height, resolution still first, and the container's audio", () => {
    expect(shape({ videoCodec: "av1", mergeFormat: "mp4" })).toEqual([
      "--merge-output-format=mp4",
      "--format-sort=lang,quality,res,fps,hdr:12,vcodec:av01,channels,acodec:aac",
    ]);
    expect(shape({ videoCodec: "vp9", mergeFormat: "webm" })).toEqual([
      "--merge-output-format=webm",
      "--format-sort=lang,quality,res,fps,hdr:12,vcodec:vp9,channels,acodec:opus",
    ]);
    expect(shape({ videoCodec: "h265" })).toEqual([
      "--format-sort=lang,quality,res,fps,hdr:12,vcodec:h265,channels,acodec",
    ]);
    expect(shape({ videoCodec: "h264", mergeFormat: "mkv" })).toEqual([
      "--merge-output-format=mkv",
      "--format-sort=lang,quality,res,fps,hdr:12,vcodec:h264,channels,acodec",
    ]);
  });

  it("leaves yt-dlp's own order alone with no codec and no container that prefers an audio", () => {
    expect(shape({})).toEqual([]);
    expect(shape({ videoCodec: null, mergeFormat: "mkv" })).toEqual(["--merge-output-format=mkv"]);
  });

  it("gives an audio-only profile no codec order", () => {
    expect(
      ytdlpArgsFor({
        format: "ba/b",
        mergeFormat: null,
        audioOnly: true,
        audioFormat: "mp3",
        extraArgs: [],
        videoCodec: null,
      }).extraArgs.some((a) => a.startsWith("--format-sort")),
    ).toBe(false);
  });

  it("passes no SponsorBlock flags: the server asks SponsorBlock itself, so files stay whole", async () => {
    const rows = await testDb.db
      .selectFrom("format_profiles")
      .selectAll()
      .where("user_id", "is", null)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(ytdlpArgsFor(argsOf(row)).extraArgs.join(" "), row.name).not.toMatch(/sponsorblock/);
    }
  });
});
