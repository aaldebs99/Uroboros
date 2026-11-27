import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { channelKey, parseChannelKey } from "./channelKey.ts";
import { inChannel } from "./channelMatch.ts";

/**
 * Hidden channels (docs/library.md "Hiding from the library"): a person keeps a channel's videos
 * out of Library › Videos and Audio, for themselves alone, as a playlist can (`hidden_channels`,
 * read by the library's `hidden` filter).
 */

/**
 * Hides channel `key` for `userId`, or shows it again. Hiding needs one of their videos showing in
 * the channel, its site's or the one they moved it to (404 otherwise); showing always works, so a
 * channel whose videos all left the library can still be let back. A key that is not one is 400.
 */
export async function setChannelHidden(
  db: Kysely<Database>,
  userId: string,
  key: string,
  hidden: boolean,
): Promise<void> {
  const c = parseChannelKey(key);
  if (c === null) throw new ApiError("bad_request", "not a valid channel key");
  const row = { user_id: userId, extractor: c.extractor, kind: c.kind, value: c.value };
  if (!hidden) {
    await db
      .deleteFrom("hidden_channels")
      .where("user_id", "=", userId)
      .where("extractor", "=", c.extractor)
      .where("kind", "=", c.kind)
      .where("value", "=", c.value)
      .execute();
    return;
  }
  const held = await db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .leftJoin("media_edits as ed", (j) =>
      j.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
    )
    .select("e.id")
    .where("e.user_id", "=", userId)
    .where(inChannel(c))
    .limit(1)
    .executeTakeFirst();
  if (held === undefined) throw new ApiError("not_found", "no such channel in your library");
  await db
    .insertInto("hidden_channels")
    .values(row)
    .onConflict((oc) => oc.columns(["user_id", "extractor", "kind", "value"]).doNothing())
    .execute();
}

/** The keys of the channels `userId` hides, as `channelKey` makes them. */
export async function hiddenChannelKeys(
  db: Kysely<Database>,
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .selectFrom("hidden_channels")
    .select(["extractor", "kind", "value"])
    .where("user_id", "=", userId)
    .execute();
  return new Set(
    rows.map((r) => channelKey(r.extractor, r.kind === "id" ? r.value : null, r.value) ?? ""),
  );
}
