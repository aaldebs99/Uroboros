import { PreviewGroup, type ReadyPreview } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import { ApiError } from "../api/errors.ts";
import type { Principal } from "../auth/guard.ts";
import type { Database } from "../db/schema.ts";
import { publishDownloadEvent } from "./events.ts";
import { findRequest, toRequest } from "./requests.ts";

const Groups = z.array(PreviewGroup);

/**
 * Keeps the entries the person picked in a preview so far, so the picker opens with them again
 * (from the bell, another tab or another device) while the preview waits, for a day from when it
 * was ready. Their open tabs hear the picked count changed.
 */
export async function saveSelection(
  db: Kysely<Database>,
  principal: Principal,
  id: string,
  entryIds: readonly string[],
): Promise<void> {
  const req = await findRequest(db, principal, id);
  if (req.state !== "choosing") throw new ApiError("conflict", "this request has no preview");
  const listed = new Set(toRequest(req).groups.flatMap((g) => g.entries.map((e) => e.id)));
  const picked = [...new Set(entryIds)];
  const missing = picked.filter((e) => !listed.has(e));
  if (missing.length > 0)
    throw new ApiError("bad_request", `not in the preview: ${missing.slice(0, 5).join(", ")}`);
  await db
    .updateTable("download_requests")
    .set({ selected: picked })
    .where("id", "=", req.id)
    .execute();
  if (req.intent === "download") {
    await publishDownloadEvent(db, { kind: "requests", userId: req.user_id });
  }
}

/**
 * The person's pasted playlists and channels whose previews wait for a pick, newest first: not a
 * search's results (the palette shows those) nor a link to subscribe to, and none past its day.
 */
export async function listReady(db: Kysely<Database>, userId: string): Promise<ReadyPreview[]> {
  const rows = await db
    .selectFrom("download_requests")
    .select(["id", "url", "title", "kind", "entries", "selected", "expires_at"])
    .where("user_id", "=", userId)
    .where("state", "=", "choosing")
    .where("intent", "=", "download")
    .where("expires_at", ">", sql<Date>`now()`)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map((row) => {
    const parsed = Groups.safeParse(row.entries);
    const groups = parsed.success ? parsed.data : [];
    const count = (gs: PreviewGroup[]) => gs.reduce((sum, g) => sum + g.entries.length, 0);
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      kind: row.kind === "channel" ? "channel" : "playlist",
      entries: count(groups),
      selected: row.selected?.length ?? count(groups.filter((g) => g.ticked)),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  });
}
