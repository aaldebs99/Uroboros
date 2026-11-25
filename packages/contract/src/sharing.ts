import { z } from "@hono/zod-openapi";
import { SkipSegment } from "./downloads.ts";
import { Chapter, SubtitleTrack } from "./library.ts";
import { PlaybackFacts } from "./playback.ts";

/** What is shared: a library entry, a manual playlist, or a YouTube playlist (docs/sharing.md). */
export const ShareKind = z.enum(["entry", "playlist", "youtube"]).openapi("ShareKind");
export type ShareKind = z.infer<typeof ShareKind>;

/** Someone a people-share reaches: one account, or everyone in one of the owner's groups. */
export const SharePerson = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("user"),
      id: z.uuid(),
      name: z.string(),
      /** The username, or the email of an SSO account. */
      handle: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("group"),
      id: z.uuid(),
      name: z.string(),
      /** Its enabled members, the owner included. */
      members: z.number().int(),
    }),
  ])
  .openapi("SharePerson");
export type SharePerson = z.infer<typeof SharePerson>;

export const SharePersonRef = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), id: z.uuid() }),
    /** One of the owner's groups (docs/sharing.md "Groups"). */
    z.object({ kind: z.literal("group"), id: z.uuid() }),
  ])
  .openapi("SharePersonRef");
export type SharePersonRef = z.infer<typeof SharePersonRef>;

const Expiry = z.iso.datetime({ offset: true }).nullable();

export const PeopleShare = z
  .object({ people: z.array(SharePerson), expiresAt: Expiry, expired: z.boolean() })
  .openapi("PeopleShare");
export type PeopleShare = z.infer<typeof PeopleShare>;

export const PublicLink = z
  .object({
    code: z.string(),
    /** `/s/<code>`, on the app's origin. */
    path: z.string(),
    allowDownload: z.boolean(),
    expiresAt: Expiry,
    expired: z.boolean(),
  })
  .openapi("PublicLink");
export type PublicLink = z.infer<typeof PublicLink>;

/** How one of the caller's things is shared (the share dialog, and a row of By me). */
export const ShareState = z
  .object({
    kind: ShareKind,
    id: z.uuid(),
    title: z.string(),
    thumbnailUrl: z.string().nullable(),
    people: PeopleShare.nullable(),
    link: PublicLink.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .openapi("ShareState");
export type ShareState = z.infer<typeof ShareState>;

/** The whole set of people; an empty list stops sharing with people. */
export const PeopleShareBody = z
  .object({ people: z.array(SharePersonRef).max(100), expiresAt: Expiry })
  .openapi("PeopleShareBody");
export type PeopleShareBody = z.infer<typeof PeopleShareBody>;

export const PublicLinkBody = z
  .object({ allowDownload: z.boolean(), expiresAt: Expiry })
  .openapi("PublicLinkBody");
export type PublicLinkBody = z.infer<typeof PublicLinkBody>;

/** A share that reaches the caller (Shared › With me). */
export const SharedWithMe = z
  .object({
    shareId: z.uuid(),
    kind: ShareKind,
    /** The entry's, manual playlist's or YouTube playlist's id. */
    id: z.uuid(),
    title: z.string(),
    thumbnailUrl: z.string().nullable(),
    /** A video's hover preview (docs/library.md); null for a playlist, or until it is made. */
    previewUrl: z.string().nullable(),
    /** Whether it is a video with a picture to preview; false for a playlist and for sound alone. */
    hasVideo: z.boolean(),
    /** A playlist's videos; null for a single video. */
    count: z.number().int().nullable(),
    owner: z.string(),
    sharedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi("SharedWithMe");
export type SharedWithMe = z.infer<typeof SharedWithMe>;

export const SharedDetail = z
  .object({
    shareId: z.uuid(),
    kind: ShareKind,
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    owner: z.string(),
    count: z.number().int().nullable(),
  })
  .openapi("SharedDetail");
export type SharedDetail = z.infer<typeof SharedDetail>;

/** Who the caller can share with: the other enabled accounts, and the groups they are in. */
export const Directory = z
  .object({
    users: z.array(z.object({ id: z.uuid(), name: z.string(), handle: z.string().nullable() })),
    groups: z.array(z.object({ id: z.uuid(), name: z.string(), members: z.number().int() })),
  })
  .openapi("Directory");
export type Directory = z.infer<typeof Directory>;

/** One video of a public link's list. */
export const PublicListItem = z
  .object({
    id: z.uuid(),
    title: z.string(),
    /** The channel, else the uploader, else the site's own name, as `LibraryEntry.channel`. */
    channel: z.string().nullable(),
    duration: z.number().nullable(),
    uploadDate: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
  })
  .openapi("PublicListItem");
export type PublicListItem = z.infer<typeof PublicListItem>;

/** What a public link shows (`/s/<code>`): never who shared it. */
export const PublicShare = z
  .object({
    kind: z.enum(["entry", "playlist"]),
    title: z.string(),
    description: z.string().nullable(),
    allowDownload: z.boolean(),
    items: z.array(PublicListItem),
  })
  .openapi("PublicShare");
export type PublicShare = z.infer<typeof PublicShare>;

/** One video of a public link with what its player needs; every URL is under the link. */
export const PublicItem = PublicListItem.extend({
  description: z.string().nullable(),
  chapters: z.array(Chapter),
  /** The SponsorBlock segments the player skips. */
  skipSegments: z.array(SkipSegment),
  subtitles: z.array(SubtitleTrack),
  streamUrl: z.string(),
  /** Present only when the link allows downloads. */
  fileUrl: z.string().nullable(),
  container: z.string().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  playbackUrl: z.string(),
  ...PlaybackFacts.shape,
}).openapi("PublicItem");
export type PublicItem = z.infer<typeof PublicItem>;
