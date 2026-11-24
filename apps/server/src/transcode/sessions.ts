import type { PlaybackRequest, PlaybackSession } from "@uroboros/contract";
import { type Kysely, type Selectable, sql } from "kysely";
import { ApiError } from "../api/errors.ts";
import type { PlaybackSessionsTable } from "../db/playbackSchema.ts";
import type { Database } from "../db/schema.ts";
import type { Viewer } from "../sharing/access.ts";
import { type SessionPlan, planSession, type RenditionFacts } from "./sessionPlan.ts";
import { keyframeBoundaries, uniformBoundaries } from "./timeline.ts";

/** Playback sessions in Postgres (docs/transcoding.md): who watches what, and how. */

export type SessionRow = Selectable<PlaybackSessionsTable>;
/** What a session stores as its plan: the plan, and where the viewer started. */
export type StoredPlan = SessionPlan & { start: number };

export const LIVE = ["queued", "starting", "running"] as const;
/** At most this many sessions of one public link play at once (nobody is signed in to tell apart). */
export const LINK_SESSIONS = 3;

/** A session's files: `.transcodes/<id>/`, out of the folders media servers read. */
export const sessionPrefix = (sid: string) => `.transcodes/${sid}/`;
export const initKey = (sid: string) => `${sessionPrefix(sid)}init.mp4`;
export const segmentKey = (sid: string, n: number) => `${sessionPrefix(sid)}seg-${String(n)}.m4s`;

const viewerColumns = (v: Viewer) =>
  "userId" in v ? { user_id: v.userId, share_code: null } : { user_id: null, share_code: v.code };

/** The facts a plan needs, with the keyframe index when there is one. */
async function facts(db: Kysely<Database>, renditionId: string) {
  return db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .leftJoin("rendition_keyframes as k", "k.rendition_id", "r.id")
    .select([
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
      "r.width",
      "r.height",
      "r.video_codec",
      "r.video_codecs",
      "r.audio_codec",
      "r.audio_codecs",
      "k.times as keyframes",
    ])
    .where("r.id", "=", renditionId)
    .executeTakeFirstOrThrow();
}

/** The plan and boundaries for a request; a remux without its keyframes yet has none. */
export async function planFor(
  db: Kysely<Database>,
  renditionId: string,
  r: PlaybackRequest,
): Promise<{ plan: StoredPlan; boundaries: number[] | null }> {
  const f = await facts(db, renditionId);
  if (f.duration === null || f.duration <= 0) {
    throw new ApiError("conflict", "this video's length is unknown, so it can't be transcoded");
  }
  const input: RenditionFacts = {
    duration: f.duration,
    width: f.width,
    height: f.height,
    videoCodec: f.video_codec,
    videoCodecs: f.video_codecs,
    audioCodec: f.audio_codec,
    audioCodecs: f.audio_codecs,
  };
  const plan = { ...planSession(input, r), start: Math.min(r.start, f.duration) };
  if (plan.boundaries === "uniform") return { plan, boundaries: uniformBoundaries(f.duration) };
  const keyframes = f.keyframes;
  return {
    plan,
    boundaries: keyframes === null ? null : keyframeBoundaries(keyframes, f.duration),
  };
}

/** Stops a viewer's live sessions of an entry; returns their ids (their runners are told). */
export async function stopViewerSessions(
  db: Kysely<Database>,
  viewer: Viewer,
  entryId: string,
): Promise<string[]> {
  if (!("userId" in viewer)) return [];
  const rows = await db
    .updateTable("playback_sessions")
    .set({ state: "stopped", stopped_at: new Date() })
    .where("entry_id", "=", entryId)
    .where("user_id", "=", viewer.userId)
    .where("state", "in", LIVE)
    .returning("id")
    .execute();
  return rows.map((r) => r.id);
}

/** Throws 429 when a public link already plays on its limit of screens. */
export async function checkLinkLimit(db: Kysely<Database>, viewer: Viewer): Promise<void> {
  if (!("code" in viewer)) return;
  const { n } = await db
    .selectFrom("playback_sessions")
    .select(db.fn.countAll<string>().as("n"))
    .where("share_code", "=", viewer.code)
    .where("state", "in", LIVE)
    .executeTakeFirstOrThrow();
  if (Number(n) >= LINK_SESSIONS) {
    throw new ApiError("too_many_requests", "this link is already playing on too many screens");
  }
}

export async function insertSession(
  db: Kysely<Database>,
  v: {
    renditionId: string;
    entryId: string;
    viewer: Viewer;
    plan: StoredPlan;
    boundaries: number[] | null;
  },
): Promise<SessionRow> {
  return db
    .insertInto("playback_sessions")
    .values({
      rendition_id: v.renditionId,
      entry_id: v.entryId,
      ...viewerColumns(v.viewer),
      quality: v.plan.quality,
      mode: v.plan.mode,
      plan: JSON.stringify(v.plan),
      boundaries: v.boundaries,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The viewer's session of the entry, live or not; anything else is 404. */
export async function viewerSession(
  db: Kysely<Database>,
  viewer: Viewer,
  entryId: string,
  sid: string,
): Promise<SessionRow> {
  const cols = viewerColumns(viewer);
  const row = await db
    .selectFrom("playback_sessions")
    .selectAll()
    .where("id", "=", sid)
    .where("entry_id", "=", entryId)
    .where((eb) =>
      cols.user_id === null
        ? eb("share_code", "=", cols.share_code)
        : eb("user_id", "=", cols.user_id),
    )
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such playback session");
  return row;
}

export const isLive = (row: SessionRow) => (LIVE as readonly string[]).includes(row.state);

/** Stops a live session; false when it was not live. */
export async function stopSession(db: Kysely<Database>, sid: string): Promise<boolean> {
  const r = await db
    .updateTable("playback_sessions")
    .set({ state: "stopped", stopped_at: new Date() })
    .where("id", "=", sid)
    .where("state", "in", LIVE)
    .executeTakeFirst();
  return r.numUpdatedRows > 0n;
}

export const planOf = (row: SessionRow) => row.plan as StoredPlan;

/** `base` is the entry's playback path (`/api/library/{id}/playback`, or a link's). */
export function toSession(row: SessionRow, base: string): PlaybackSession {
  const plan = planOf(row);
  const url = `${base}/sessions/${row.id}`;
  return {
    id: row.id,
    state: row.state,
    mode: row.mode,
    quality: plan.quality,
    encoder: row.encoder,
    width: plan.width,
    height: plan.height,
    reason: plan.reason,
    url,
    masterUrl: `${url}/master.m3u8`,
    error: row.error_message,
  };
}
