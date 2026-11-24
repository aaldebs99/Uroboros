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

async function list(): Promise<FormatProfile[]> {
  return z
    .array(FormatProfile)
    .parse(await (await send(member, "GET", "/api/format-profiles")).json());
}

async function create(over: Record<string, unknown> = {}): Promise<Response> {
  return send(admin, "POST", "/api/admin/format-profiles", {
    name: `p-${randomUUID().slice(0, 8)}`,
    format: "bv*+ba/b",
    ...over,
  });
}

describe("format profiles", () => {
  it("seeds revisions that profileRevision reproduces", async () => {
    for (const p of await list()) expect(p.revision).toBe(profileRevision(p));
  });

  it("lists profiles for a member, who may not create one", async () => {
    expect((await list()).length).toBeGreaterThanOrEqual(3);
    const res = await send(member, "POST", "/api/admin/format-profiles", {
      name: "x",
      format: "b",
    });
    expect(res.status).toBe(403);
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
    const renamed = FormatProfile.parse(
      await (
        await send(admin, "PATCH", `/api/admin/format-profiles/${p.id}`, { name: `${p.name}-2` })
      ).json(),
    );
    expect(renamed.revision).toBe(p.revision);
    const reformatted = FormatProfile.parse(
      await (
        await send(admin, "PATCH", `/api/admin/format-profiles/${p.id}`, { format: "b" })
      ).json(),
    );
    expect(reformatted.revision).not.toBe(p.revision);
  });

  it("changes the revision when SponsorBlock categories are added, not when they are reordered", async () => {
    const p = FormatProfile.parse(await (await create()).json());
    expect(p.sponsorblockRemove).toEqual([]);
    const cut = FormatProfile.parse(
      await (
        await send(admin, "PATCH", `/api/admin/format-profiles/${p.id}`, {
          sponsorblockRemove: ["sponsor", "intro", "sponsor"],
        })
      ).json(),
    );
    expect(cut.sponsorblockRemove).toEqual(["intro", "sponsor"]);
    expect(cut.revision).not.toBe(p.revision);
    const reordered = FormatProfile.parse(
      await (
        await send(admin, "PATCH", `/api/admin/format-profiles/${p.id}`, {
          sponsorblockRemove: ["intro", "sponsor"],
        })
      ).json(),
    );
    expect(reordered.revision).toBe(cut.revision);
    expect(reordered.revision).toBe(profileRevision(reordered));
  });

  it("refuses an unknown SponsorBlock category (400)", async () => {
    expect((await create({ sponsorblockRemove: ["poi_highlight"] })).status).toBe(400);
  });

  it("keeps exactly one default", async () => {
    const p = FormatProfile.parse(await (await create()).json());
    const res = await send(admin, "PATCH", `/api/admin/format-profiles/${p.id}`, {
      isDefault: true,
    });
    expect(res.status).toBe(200);
    const defaults = (await list()).filter((x) => x.isDefault);
    expect(defaults.map((x) => x.id)).toEqual([p.id]);
    const seed = (await list()).find((x) => x.name === "Best available");
    await send(admin, "PATCH", `/api/admin/format-profiles/${seed?.id ?? ""}`, { isDefault: true });
  });

  it("refuses deleting the default or a profile in use, and deletes an unused one", async () => {
    const def = (await list()).find((x) => x.isDefault);
    expect(
      (await send(admin, "DELETE", `/api/admin/format-profiles/${def?.id ?? ""}`)).status,
    ).toBe(409);
    const used = FormatProfile.parse(await (await create()).json());
    const media = await testDb.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: randomUUID() })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("renditions")
      .values({
        media_id: media.id,
        profile_id: used.id,
        profile_revision: used.revision,
        storage_key: "k",
        size_bytes: 1,
      })
      .execute();
    expect((await send(admin, "DELETE", `/api/admin/format-profiles/${used.id}`)).status).toBe(409);
    const unused = FormatProfile.parse(await (await create()).json());
    expect((await send(admin, "DELETE", `/api/admin/format-profiles/${unused.id}`)).status).toBe(
      204,
    );
  });

  it("refuses a duplicate name (409)", async () => {
    expect((await create({ name: "Best available" })).status).toBe(409);
  });
});

describe("ytdlpArgsFor", () => {
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

  it("passes --sponsorblock-remove to yt-dlp", () => {
    const base = { format: "b", mergeFormat: null, audioOnly: false, audioFormat: null };
    expect(
      ytdlpArgsFor({ ...base, extraArgs: [], sponsorblockRemove: ["sponsor", "intro"] }).extraArgs,
    ).toContain("--sponsorblock-remove=intro,sponsor");
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
