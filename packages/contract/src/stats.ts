import { z } from "@hono/zod-openapi";

/**
 * Admin › Stats (docs/library.md "Stats"): what the library holds and what it takes up. A file is
 * stored once for everyone who has it, and counts for whoever's library entry for it is oldest,
 * so the people's storage adds up to what the files they hold take.
 */

const Count = z.number().int().nonnegative();
/** Bytes. */
const Bytes = z.number().int().nonnegative();

/** What stored files are: the media themselves and everything kept beside or for them. */
export const STORAGE_KINDS = [
  "files",
  "thumbnails",
  "info",
  "previews",
  "subtitles",
  "exports",
  "uploads",
  "playback",
] as const;
export const StorageKind = z.enum(STORAGE_KINDS).openapi("StorageKind");
export type StorageKind = z.infer<typeof StorageKind>;

/** The stored media files (one per video and format), videos and audio apart. */
export const MediaFileCounts = z
  .object({ total: Count, videos: Count, audio: Count, bytes: Bytes })
  .openapi("MediaFileCounts");
export type MediaFileCounts = z.infer<typeof MediaFileCounts>;

/** The media files of one container (their extension: mp4, webm, m4a…), or `unknown`. */
export const ContainerStats = z
  .object({ container: z.string(), files: Count, bytes: Bytes })
  .openapi("ContainerStats");
export type ContainerStats = z.infer<typeof ContainerStats>;

/** Everything stored: each kind's bytes, and how many files still wait to be measured. */
export const StorageStats = z
  .object({
    total: Bytes,
    parts: z.array(z.object({ kind: StorageKind, bytes: Bytes })),
    /** Files whose size the leader has yet to measure, not in the bytes yet. */
    unmeasured: Count,
  })
  .openapi("StorageStats");
export type StorageStats = z.infer<typeof StorageStats>;

/** One person: what their library holds, and the storage that counts for them. */
export const PersonStats = z
  .object({
    userId: z.uuid(),
    displayName: z.string(),
    username: z.string().nullable(),
    /** Their library's entries. */
    items: Count,
    videos: Count,
    audio: Count,
    /** The files that count for them (theirs first), the copies they saved and uploads underway. */
    bytes: Bytes,
  })
  .openapi("PersonStats");
export type PersonStats = z.infer<typeof PersonStats>;

export const AdminStats = z
  .object({
    files: MediaFileCounts,
    /** Largest first. */
    containers: z.array(ContainerStats),
    storage: StorageStats,
    /** Everyone, most storage first. */
    people: z.array(PersonStats),
    /** Files in no one's library, kept a day before the reaper deletes them, with their media's. */
    unclaimed: z.object({ files: Count, bytes: Bytes }),
  })
  .openapi("AdminStats");
export type AdminStats = z.infer<typeof AdminStats>;
