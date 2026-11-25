import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { createEmptyDatabase } from "../../test/testDb.ts";
import { createDb } from "../db/kysely.ts";
import type { Database } from "../db/schema.ts";
import { defaultMigrationsDir } from "./dir.ts";
import { runMigrations } from "./runner.ts";

/**
 * 20261125183029_hide_playlists_from_library.sql, applied over 0.1.0's schema with rows in it: the
 * account-wide Hide playlist videos setting becomes every playlist of its owner hiding.
 */

const BASELINE = "20261122000000_schema.sql";
const MIGRATION = "20261125183029_hide_playlists_from_library.sql";

let empty: Awaited<ReturnType<typeof createEmptyDatabase>>;
let db: Kysely<Database>;
let dir: string;

const people: Record<"hider" | "shower" | "unset", string> = { hider: "", shower: "", unset: "" };
let sourceId = "";

const stage = (name: string) => copyFile(join(defaultMigrationsDir(), name), join(dir, name));

beforeAll(async () => {
  empty = await createEmptyDatabase(inject("postgresUrl"));
  db = createDb(empty.url);
  dir = await mkdtemp(join(tmpdir(), "uroboros-migration-"));
  await stage(BASELINE);
  await runMigrations(db, dir);
  for (const who of ["hider", "shower", "unset"] as const) {
    people[who] = (await signedIn(db, { username: `hp-${who}` })).userId;
  }
  // The hider had the chip on, the shower had it off, and the last never chose (no row).
  await db
    .insertInto("user_preferences")
    .values([
      { user_id: people.hider, hide_playlist_videos: true },
      { user_id: people.shower, hide_playlist_videos: false },
    ])
    .execute();
  await db
    .insertInto("playlists")
    .values(Object.values(people).map((user_id) => ({ user_id, name: "Mine" })))
    .execute();
  const source = await db
    .insertInto("sources")
    .values({
      extractor: "youtube",
      source_id: "PLhp",
      kind: "playlist",
      url: "https://www.youtube.com/playlist?list=PLhp",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  sourceId = source.id;
  await db
    .insertInto("user_sources")
    .values(Object.values(people).map((user_id) => ({ user_id, source_id: sourceId })))
    .execute();
  await stage(MIGRATION);
  await runMigrations(db, dir);
});

afterAll(async () => {
  await db.destroy();
  await empty.drop();
  await rm(dir, { recursive: true, force: true });
});

async function hidden(userId: string) {
  const own = await db
    .selectFrom("playlists")
    .select("hide_from_library")
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  const youtube = await db
    .selectFrom("user_sources")
    .select("hide_from_library")
    .where("user_id", "=", userId)
    .where("source_id", "=", sourceId)
    .executeTakeFirstOrThrow();
  return { own: own.hide_from_library, youtube: youtube.hide_from_library };
}

describe(MIGRATION, () => {
  it("hides every playlist of whoever had Hide playlist videos on", async () => {
    expect(await hidden(people.hider)).toEqual({ own: true, youtube: true });
  });

  it("leaves everyone else's playlists showing", async () => {
    expect(await hidden(people.shower)).toEqual({ own: false, youtube: false });
    expect(await hidden(people.unset)).toEqual({ own: false, youtube: false });
  });

  it("hides a YouTube playlist for the hider alone, though everyone shares it", async () => {
    const rows = await db
      .selectFrom("user_sources")
      .select(["user_id", "hide_from_library"])
      .where("source_id", "=", sourceId)
      .execute();
    expect(rows.filter((r) => r.hide_from_library).map((r) => r.user_id)).toEqual([people.hider]);
  });
});
