import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";

let t: TestDb;
beforeEach(async () => {
  t = await TestDb.create();
});
afterEach(async () => {
  await t.close();
});

const device = (userId: string, endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) =>
  sql`INSERT INTO push_devices (user_id, endpoint, p256dh, auth, label)
      VALUES (${userId}, ${endpoint}, 'k', 'a', 'test')`;

async function localUser(username: string): Promise<string> {
  const row = await t.db
    .insertInto("users")
    .values({ username, password_hash: "x", display_name: username, role: "member" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function errCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe("schema: users and auth", () => {
  it("refuses push devices for an unknown user (foreign key)", async () => {
    expect(await errCode(device(randomUUID()).execute(t.db))).toBe("23503");
  });

  it("refuses an account that is both local and SSO", async () => {
    const both = t.db
      .insertInto("users")
      .values({
        username: "both",
        password_hash: "x",
        oidc_issuer: "https://sso.example",
        oidc_subject: "sub",
        display_name: "Both",
        role: "member",
      })
      .execute();
    expect(await errCode(both)).toBe("23514");
  });

  it("accepts push devices for a real user", async () => {
    const id = await localUser("owner");
    await expect(device(id).execute(t.db)).resolves.toBeDefined();
  });

  it("refuses an enabled account with no way to sign in", async () => {
    const none = t.db
      .insertInto("users")
      .values({ display_name: "Nobody", role: "member" })
      .execute();
    expect(await errCode(none)).toBe("23514");
  });

  it("keeps usernames unique case-insensitively stored lower-case", async () => {
    await localUser("alice");
    expect(await errCode(localUser("alice"))).toBe("23505");
  });

  it("allows only one bootstrap account", async () => {
    const a = await localUser("a");
    const b = await localUser("b");
    await t.db.updateTable("users").set({ bootstrap: true }).where("id", "=", a).execute();
    expect(
      await errCode(
        t.db.updateTable("users").set({ bootstrap: true }).where("id", "=", b).execute(),
      ),
    ).toBe("23505");
  });

  it("deleting a user cascades sessions, tokens, grants, devices and tombstones", async () => {
    const id = await localUser("gone");
    await t.db
      .insertInto("auth_sessions")
      .values({
        token_hash: Buffer.alloc(32, 1),
        user_id: id,
        csrf: "c",
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute();
    await t.db
      .insertInto("api_tokens")
      .values({ user_id: id, name: "t", token_hash: Buffer.alloc(32, 2) })
      .execute();
    await t.db.insertInto("oidc_grants").values({ user_id: id, refresh_token: "r" }).execute();
    await device(id).execute(t.db);
    await t.db
      .insertInto("push_device_tombstones")
      .values({ endpoint_hash: Buffer.alloc(32, 3), user_id: id })
      .execute();

    await t.db.deleteFrom("users").where("id", "=", id).execute();

    for (const table of [
      "auth_sessions",
      "api_tokens",
      "oidc_grants",
      "push_devices",
      "push_device_tombstones",
    ] as const) {
      const { n } = await t.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("user_id", "=", id)
        .executeTakeFirstOrThrow();
      expect([table, n]).toEqual([table, "0"]);
    }
  });

  it("keeps API token names unique per user", async () => {
    const id = await localUser("tok");
    await t.db
      .insertInto("api_tokens")
      .values({ user_id: id, name: "x", token_hash: Buffer.alloc(32, 4) })
      .execute();
    expect(
      await errCode(
        t.db
          .insertInto("api_tokens")
          .values({ user_id: id, name: "x", token_hash: Buffer.alloc(32, 5) })
          .execute(),
      ),
    ).toBe("23505");
  });
});

describe("schema: downloads, media and profiles", () => {
  const profiles = (db = t.db) =>
    db.selectFrom("format_profiles").select(["id", "name", "is_default"]).orderBy("name").execute();

  async function media(videoId = randomUUID()): Promise<string> {
    const row = await t.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: videoId, title: "t" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function defaultProfile(): Promise<{ id: string; revision: string }> {
    return t.db
      .selectFrom("format_profiles")
      .select(["id", "revision"])
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
  }

  const rendition = (mediaId: string, p: { id: string; revision: string }) =>
    t.db
      .insertInto("renditions")
      .values({
        media_id: mediaId,
        profile_id: p.id,
        profile_revision: p.revision,
        storage_key: `k/${randomUUID()}`,
        size_bytes: 1,
      })
      .returning("id");

  const download = (userId: string, p: { id: string; revision: string }, fetchKey: string) =>
    t.db.insertInto("downloads").values({
      user_id: userId,
      profile_id: p.id,
      profile_revision: p.revision,
      args: JSON.stringify({}),
      extractor: "youtube",
      video_id: "v",
      url: "https://example.org/v",
      fetch_key: fetchKey,
    });

  it("seeds the built-in profiles with Best available as default", async () => {
    expect(await profiles()).toEqual(
      [
        "Archive (MKV, uncut)",
        "Audio only (Opus)",
        "Best available",
        "Best up to 1080p (MP4)",
        "Music (MP3)",
        "Podcasts (M4A)",
        "Up to 720p (MP4)",
      ].map((name) => ({
        id: expect.any(String) as string,
        name,
        is_default: name === "Best available",
      })),
    );
  });

  it("seeds the built-ins' SponsorBlock cuts: the usual three, music's non-music too, none for the archive", async () => {
    const rows = await t.db
      .selectFrom("format_profiles")
      .select(["name", "sponsorblock_remove"])
      .where("user_id", "is", null)
      .execute();
    const usual = ["interaction", "selfpromo", "sponsor"];
    for (const row of rows) {
      const expected =
        row.name === "Music (MP3)"
          ? ["interaction", "music_offtopic", "selfpromo", "sponsor"]
          : row.name === "Archive (MKV, uncut)"
            ? []
            : usual;
      expect(row.sponsorblock_remove, row.name).toEqual(expected);
    }
  });

  it("allows one default format profile", async () => {
    expect(
      await errCode(
        t.db
          .insertInto("format_profiles")
          .values({ name: "x", format: "b", revision: "r", is_default: true })
          .execute(),
      ),
    ).toBe("23505");
  });

  it("refuses a second rendition for the same media, profile and revision", async () => {
    const m = await media();
    const p = await defaultProfile();
    await rendition(m, p).execute();
    expect(await errCode(rendition(m, p).execute())).toBe("23505");
    expect(await errCode(rendition(m, { ...p, revision: "other" }).execute())).toBeUndefined();
  });

  it("refuses a second active download of the same fetch key for one user but allows it once done", async () => {
    const u = await localUser("dl");
    const p = await defaultProfile();
    await download(u, p, "fetch:a").execute();
    expect(await errCode(download(u, p, "fetch:a").execute())).toBe("23505");
    await t.db.updateTable("downloads").set({ state: "done" }).where("user_id", "=", u).execute();
    expect(await errCode(download(u, p, "fetch:a").execute())).toBeUndefined();
  });

  it("keeps a profile's renditions, with no profile, when it goes (the API refuses while a library uses one)", async () => {
    const owner = await localUser("profile-owner");
    const p = await t.db
      .insertInto("format_profiles")
      .values({ user_id: owner, name: "Mine", format: "b", revision: "r1" })
      .returning(["id", "revision"])
      .executeTakeFirstOrThrow();
    const r = await rendition(await media(), p).executeTakeFirstOrThrow();
    await t.db.deleteFrom("format_profiles").where("id", "=", p.id).execute();
    const left = await t.db
      .selectFrom("renditions")
      .select("profile_id")
      .where("id", "=", r.id)
      .executeTakeFirstOrThrow();
    expect(left.profile_id).toBeNull();
  });

  it("deletes a user's downloads, requests and library entries with the user", async () => {
    const u = await localUser("gone");
    const p = await defaultProfile();
    const m = await media();
    const r = await rendition(m, p).executeTakeFirstOrThrow();
    await t.db
      .insertInto("library_entries")
      .values({ user_id: u, media_id: m, rendition_id: r.id })
      .execute();
    await t.db
      .insertInto("download_requests")
      .values({ user_id: u, url: "https://example.org/p", profile_id: p.id })
      .execute();
    await download(u, p, "fetch:b").execute();
    await t.db.deleteFrom("users").where("id", "=", u).execute();
    for (const table of ["library_entries", "download_requests", "downloads"] as const) {
      const { n } = await t.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("user_id", "=", u)
        .executeTakeFirstOrThrow();
      expect([table, n]).toEqual([table, "0"]);
    }
  });
});

describe("schema: library", () => {
  async function media(title: string): Promise<string> {
    const row = await t.db
      .insertInto("media")
      .values({
        extractor: "youtube",
        video_id: randomUUID(),
        title,
        channel: "Blender",
        description: "An open movie",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it("indexes title, channel and description for search", async () => {
    const id = await media("Big Buck Bunny");
    for (const q of ["bunny", "blender", "movie"]) {
      const hit = await sql<{
        id: string;
      }>`SELECT id FROM media WHERE search @@ to_tsquery('simple', ${q})`.execute(t.db);
      expect(hit.rows.map((r) => r.id)).toContain(id);
    }
  });

  it("keeps one progress row per person and media", async () => {
    const u = await localUser("prog");
    const m = await media("p");
    const row = () =>
      t.db
        .insertInto("watch_progress")
        .values({ user_id: u, media_id: m, position_s: 1, duration_s: 10 })
        .execute();
    await row();
    expect(await errCode(row())).toBe("23505");
  });

  it("removes a person's tags, progress and playlists with them", async () => {
    const u = await localUser("libgone");
    const m = await media("g");
    const p = await t.db
      .selectFrom("format_profiles")
      .select(["id", "revision"])
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
    const r = await t.db
      .insertInto("renditions")
      .values({
        media_id: m,
        profile_id: p.id,
        profile_revision: p.revision,
        storage_key: `k/${randomUUID()}`,
        size_bytes: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const e = await t.db
      .insertInto("library_entries")
      .values({ user_id: u, media_id: m, rendition_id: r.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db.insertInto("entry_tags").values({ entry_id: e.id, tag: "music" }).execute();
    await t.db
      .insertInto("watch_progress")
      .values({ user_id: u, media_id: m, position_s: 1, duration_s: 10 })
      .execute();
    const s = await t.db
      .insertInto("sources")
      .values({
        extractor: "youtube",
        source_id: randomUUID(),
        kind: "playlist",
        title: "P",
        url: "https://x.example/p",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db.insertInto("user_sources").values({ user_id: u, source_id: s.id }).execute();
    await t.db.deleteFrom("users").where("id", "=", u).execute();
    expect(
      await t.db.selectFrom("entry_tags").selectAll().where("entry_id", "=", e.id).execute(),
    ).toEqual([]);
    expect(
      await t.db.selectFrom("watch_progress").selectAll().where("user_id", "=", u).execute(),
    ).toEqual([]);
    expect(
      await t.db.selectFrom("user_sources").selectAll().where("user_id", "=", u).execute(),
    ).toEqual([]);
  });
});
