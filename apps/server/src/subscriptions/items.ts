import type { SubscriptionItemsPage } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { ownSubscription } from "./store.ts";

export const ITEMS_PAGE_SIZE = 50;

interface ItemCursor {
  seenAt: string;
  extractor: string;
  videoId: string;
}

const encode = (c: ItemCursor) =>
  Buffer.from(JSON.stringify([c.seenAt, c.extractor, c.videoId])).toString("base64url");

/** Throws `bad_request` for anything this server did not make. */
function decode(raw: string): ItemCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((p) => typeof p === "string") &&
      !Number.isNaN(Date.parse(parsed[0] as string))
    ) {
      const [seenAt, extractor, videoId] = parsed as [string, string, string];
      return { seenAt, extractor, videoId };
    }
  } catch {
    // reported below
  }
  throw new ApiError("bad_request", "not a valid cursor");
}

/** A subscription's recent activity, newest first, with the caller's entry for each download. */
export async function listItems(
  db: Kysely<Database>,
  userId: string,
  subscriptionId: string,
  cursor: string | undefined,
): Promise<SubscriptionItemsPage> {
  await ownSubscription(db, userId, subscriptionId);
  let q = db
    .selectFrom("subscription_items as i")
    .leftJoin("downloads as d", "d.id", "i.download_id")
    .leftJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").on("e.user_id", "=", userId),
    )
    .select([
      "i.extractor",
      "i.video_id",
      "i.title",
      "i.url",
      "i.outcome",
      "i.reason",
      "i.seen_at",
      sql<string>`i.seen_at::text`.as("seen_text"),
      "i.due_at",
      "i.download_id",
      "e.id as entry_id",
    ])
    .where("i.subscription_id", "=", subscriptionId);
  if (cursor !== undefined) {
    const c = decode(cursor);
    q = q.where(
      sql<boolean>`(i.seen_at, i.extractor, i.video_id) < (${c.seenAt}::timestamptz, ${c.extractor}, ${c.videoId})`,
    );
  }
  const rows = await q
    .orderBy("i.seen_at", "desc")
    .orderBy("i.extractor", "desc")
    .orderBy("i.video_id", "desc")
    .limit(ITEMS_PAGE_SIZE + 1)
    .execute();
  const page = rows.slice(0, ITEMS_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      extractor: r.extractor,
      videoId: r.video_id,
      title: r.title,
      url: r.url,
      outcome: r.outcome,
      reason: r.reason,
      seenAt: new Date(r.seen_at).toISOString(),
      dueAt: r.due_at === null ? null : new Date(r.due_at).toISOString(),
      downloadId: r.download_id,
      entryId: r.entry_id,
    })),
    nextCursor:
      rows.length > ITEMS_PAGE_SIZE && last !== undefined
        ? encode({ seenAt: last.seen_text, extractor: last.extractor, videoId: last.video_id })
        : null,
  };
}
