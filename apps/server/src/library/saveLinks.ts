import { createHash, randomBytes } from "node:crypto";
import type { SaveLink } from "@uroboros/contract";
import { type Kysely, sql } from "kysely";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";

/**
 * Save links (docs/downloads.md#saving-a-file): the installed iPhone app hands Save to Safari, which
 * doesn't have the app's cookies (iOS gives a home-screen app its own storage), so Safari gets a
 * link that needs none. It is a random token, stored only as its SHA-256, naming
 * one entry or finished copy of the person's; it works for any number of requests (iOS's downloader
 * resumes with ranges) until it expires an hour on, and access is checked again on every use.
 */

/** What a save link saves: an entry the person sees, or one of their finished copies. */
export type SaveTarget = { entryId: string } | { exportId: string };

const hashOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/**
 * How long a save link that isn't there yet is waited for: the app hands Safari a link whose token
 * it chose inside the tap, and registers it alongside, so Safari can ask first.
 */
export const SAVE_LINK_WAIT_MS = 1500;
const WAIT_STEP_MS = 150;

/**
 * A new save link for `userId`, who must already have been allowed the target: under `token` when
 * the app chose one (`conflict` if it is taken), else a fresh random one.
 */
export async function createSaveLink(
  db: Kysely<Database>,
  userId: string,
  target: SaveTarget,
  token: string = randomBytes(32).toString("base64url"),
): Promise<SaveLink> {
  const row = await db
    .insertInto("save_links")
    .values({
      token_hash: hashOf(token),
      user_id: userId,
      entry_id: "entryId" in target ? target.entryId : null,
      export_id: "exportId" in target ? target.exportId : null,
      expires_at: sql<Date>`now() + interval '1 hour'`,
    })
    .onConflict((oc) => oc.column("token_hash").doNothing())
    .returning("expires_at")
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("conflict", "that token is taken");
  return { url: `/api/public/saves/${token}`, expiresAt: row.expires_at.toISOString() };
}

const findLink = (db: Kysely<Database>, hash: Buffer) =>
  db
    .selectFrom("save_links")
    .select(["user_id", "entry_id", "export_id"])
    .where("token_hash", "=", hash)
    .where("expires_at", ">", sql<Date>`now()`)
    .executeTakeFirst();

/**
 * Whose link `token` is and what it saves, waiting up to `SAVE_LINK_WAIT_MS` for one still being
 * registered; `not_found` for one unknown or expired.
 */
export async function resolveSaveLink(
  db: Kysely<Database>,
  token: string,
): Promise<{ userId: string; target: SaveTarget }> {
  const hash = hashOf(token);
  let row = await findLink(db, hash);
  for (let waited = 0; row === undefined && waited < SAVE_LINK_WAIT_MS; waited += WAIT_STEP_MS) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    row = await findLink(db, hash);
  }
  if (row === undefined) throw new ApiError("not_found", "the link doesn't work any more");
  if (row.entry_id !== null) return { userId: row.user_id, target: { entryId: row.entry_id } };
  if (row.export_id !== null) return { userId: row.user_id, target: { exportId: row.export_id } };
  throw new ApiError("not_found", "the link doesn't work any more");
}

/** Deletes the expired save links (the leader's sweeper); returns how many went. */
export async function sweepExpiredSaveLinks(db: Kysely<Database>): Promise<number> {
  const res = await db
    .deleteFrom("save_links")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();
  return Number(res.numDeletedRows);
}
