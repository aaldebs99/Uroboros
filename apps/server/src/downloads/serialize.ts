import { DownloadErrorKind, type Download } from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
import type { Database, DownloadsTable } from "../db/schema.ts";
import { latestProgress } from "./events.ts";
import type { DownloadContext } from "./dispatch.ts";

export type DownloadRow = Selectable<DownloadsTable> & { owner_name: string };

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** Downloads with their owner's name; `userId` null lists everyone's. Active first, then newest. */
export async function downloadRows(
  db: Kysely<Database>,
  opts: { userId: string | null; ids?: string[]; limit?: number },
): Promise<DownloadRow[]> {
  return db
    .selectFrom("downloads as d")
    .innerJoin("users as u", "u.id", "d.user_id")
    .selectAll("d")
    .select("u.display_name as owner_name")
    .$if(opts.userId !== null, (qb) => qb.where("d.user_id", "=", opts.userId ?? ""))
    .$if(opts.ids !== undefined, (qb) => qb.where("d.id", "in", opts.ids ?? []))
    .orderBy((eb) => eb.case().when("d.state", "in", ["queued", "running"]).then(0).else(1).end())
    .orderBy("d.created_at", "desc")
    .limit(opts.limit ?? 500)
    .execute();
}

export async function toDownloads(ctx: DownloadContext, rows: DownloadRow[]): Promise<Download[]> {
  const active = rows
    .filter((r) => r.state === "running" || r.state === "queued")
    .map((r) => r.fetch_key);
  const progress = await latestProgress(ctx.db, [...new Set(active)]);
  return rows.map((r) => {
    const kind = DownloadErrorKind.safeParse(r.error_kind);
    return {
      id: r.id,
      owner: { id: r.user_id, displayName: r.owner_name },
      url: r.url,
      title: r.title,
      extractor: r.extractor,
      videoId: r.video_id,
      profileId: r.profile_id,
      fetchKey: r.fetch_key,
      state: r.state,
      progress: r.state === "running" ? (progress.get(r.fetch_key) ?? null) : null,
      errorKind: kind.success ? kind.data : null,
      errorMessage: r.error_message,
      stderrTail: r.stderr_tail,
      attempts: r.attempts,
      createdAt: r.created_at.toISOString(),
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
    };
  });
}
