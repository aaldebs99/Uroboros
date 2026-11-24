import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, FormatProfile } from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { profileRevision, ytdlpArgsFor } from "./profiles.ts";

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
  it("seeds built-ins whose revisions profileRevision reproduces, listed for everyone", async () => {
    const builtIns = (await list()).filter((p) => p.builtIn);
    expect(builtIns.map((p) => p.name)).toEqual([
      "Archive (MKV, uncut)",
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

  it("changes the revision when SponsorBlock categories are added, not when they are reordered", async () => {
    const p = FormatProfile.parse(await (await create()).json());
    expect(p.sponsorblockRemove).toEqual([]);
    const cut = FormatProfile.parse(
      await (await patch(p.id, { sponsorblockRemove: ["sponsor", "intro", "sponsor"] })).json(),
    );
    expect(cut.sponsorblockRemove).toEqual(["intro", "sponsor"]);
    expect(cut.revision).not.toBe(p.revision);
    const reordered = FormatProfile.parse(
      await (await patch(p.id, { sponsorblockRemove: ["intro", "sponsor"] })).json(),
    );
    expect(reordered.revision).toBe(cut.revision);
    expect(reordered.revision).toBe(profileRevision(reordered));
  });

  it("refuses an unknown SponsorBlock category (400)", async () => {
    expect((await create({ sponsorblockRemove: ["poi_highlight"] })).status).toBe(400);
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

describe("ytdlpArgsFor", () => {
  it("runs the Music built-in as best-quality MP3 with its cover, cutting non-music sections", async () => {
    const music = (await list()).find((p) => p.name === "Music (MP3)");
    expect(music).toBeDefined();
    if (music === undefined) return;
    expect(ytdlpArgsFor(music)).toEqual({
      format: "ba/b",
      extraArgs: [
        "--extract-audio",
        "--audio-format=mp3",
        "--write-thumbnail",
        "--convert-thumbnails=jpg",
        "--sponsorblock-remove=interaction,music_offtopic,selfpromo,sponsor",
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
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
      "--embed-chapters",
    ]);
  });

  it("marks a video's SponsorBlock segments for the player to skip, and cuts an audio file's", () => {
    const base = { format: "b", mergeFormat: null, audioOnly: false, audioFormat: null };
    const video = ytdlpArgsFor({
      ...base,
      extraArgs: [],
      sponsorblockRemove: ["sponsor", "intro"],
    }).extraArgs;
    // A stream-copied cut desyncs a video (each part restarts at a keyframe); marking cuts nothing.
    expect(video).toContain("--sponsorblock-mark=intro,sponsor");
    expect(video.join(" ")).not.toMatch(/sponsorblock-remove/);
    expect(
      ytdlpArgsFor({
        ...base,
        audioOnly: true,
        audioFormat: "opus",
        extraArgs: [],
        sponsorblockRemove: ["sponsor"],
      }).extraArgs,
    ).toContain("--sponsorblock-remove=sponsor");
    expect(ytdlpArgsFor({ ...base, extraArgs: [], sponsorblockRemove: [] }).extraArgs).toEqual([
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
    ]);
    // A download queued before profiles had categories snapshotted none.
    expect(ytdlpArgsFor({ ...base, extraArgs: [] }).extraArgs.join(" ")).not.toMatch(
      /sponsorblock/,
    );
  });
});
