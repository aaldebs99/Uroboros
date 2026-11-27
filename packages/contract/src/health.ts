import { z } from "@hono/zod-openapi";

/**
 * Admin › Health (docs/health.md): the replicas running and how each is, the version, and the rate
 * limits sites put on this server: the cooldowns now, and the limits of the past week.
 */

const Count = z.number().int().nonnegative();

/**
 * `ok` and `degraded` (a check of its own fails) for a replica that checked in within 45 s;
 * `not_answering` for one that hasn't since.
 */
export const ReplicaStatus = z.enum(["ok", "degraded", "not_answering"]).openapi("ReplicaStatus");
export type ReplicaStatus = z.infer<typeof ReplicaStatus>;

/** What a replica checks for itself as it checks in. */
export const ReplicaCheck = z.enum(["storage"]).openapi("ReplicaCheck");
export type ReplicaCheck = z.infer<typeof ReplicaCheck>;

export const Replica = z
  .object({
    id: z.uuid(),
    host: z.string(),
    /** The release it runs; replicas differ while a rollout is underway. */
    version: z.string(),
    startedAt: z.iso.datetime(),
    /** When it last checked in (every 15 s). */
    seenAt: z.iso.datetime(),
    /** Whether it is the leader (docs/jobs.md), which runs the singleton work. */
    leader: z.boolean(),
    status: ReplicaStatus,
    failing: z.array(ReplicaCheck),
    /** The jobs it runs right now. */
    runningJobs: Count,
    /** Whether it is the replica that answered this request. */
    current: z.boolean(),
  })
  .openapi("Replica");
export type Replica = z.infer<typeof Replica>;

/** What a cooldown holds back: everything asked of the site, or only its subtitles. */
export const CooldownScope = z.enum(["site", "subtitles"]).openapi("CooldownScope");
export type CooldownScope = z.infer<typeof CooldownScope>;

/** A site limiting this server's requests (docs/downloads.md "Rate limits"). */
export const SiteCooldown = z
  .object({
    /** The link's host, without `www.` and the like (youtu.be is youtube.com). */
    site: z.string(),
    scope: CooldownScope,
    /** When the site is asked again. */
    until: z.iso.datetime(),
    /** The limits in a row, which lengthen an estimated cooldown. */
    strikes: Count,
    /** Whether it still runs; one that ran out waits for the site to answer, which clears it. */
    active: z.boolean(),
    /** The people's downloads, and pasted links, waiting on the site now. */
    waitingDownloads: Count,
    waitingLinks: Count,
  })
  .openapi("SiteCooldown");
export type SiteCooldown = z.infer<typeof SiteCooldown>;

/** The kind of work a site's rate limit held. */
export const RateLimitSource = z
  .enum(["download", "link", "search", "subscription", "preview", "subtitles"])
  .openapi("RateLimitSource");
export type RateLimitSource = z.infer<typeof RateLimitSource>;

/** One rate limit a site answered with, and the cooldown it set. */
export const RateLimitEvent = z
  .object({
    id: z.uuid(),
    at: z.iso.datetime(),
    site: z.string(),
    scope: CooldownScope,
    source: RateLimitSource,
    /** yt-dlp's message (its last error line, redacted). */
    message: z.string(),
    /** The video's (or subscription's) link and title, when known. */
    url: z.string().nullable(),
    title: z.string().nullable(),
    /**
     * The stored video it held (subtitles fetched apart, a hover preview's copy) in the viewer's
     * own library, to open there; null when it held none, or the viewer doesn't hold it.
     */
    entryId: z.uuid().nullable(),
    /** When the site is asked again: the cooldown's end. */
    until: z.iso.datetime(),
    /** Whether the site said how long to wait; otherwise the cooldown is an estimate. */
    hinted: z.boolean(),
    strikes: Count,
  })
  .openapi("RateLimitEvent");
export type RateLimitEvent = z.infer<typeof RateLimitEvent>;

export const AdminHealth = z
  .object({
    /** The version of the replica that answered. */
    version: z.string(),
    /** Every replica that checked in within the hour, this one first, then by host. */
    replicas: z.array(Replica),
    /** Every site's cooldown, active ones first. */
    cooldowns: z.array(SiteCooldown),
    /** The newest 100 limits of the past week, newest first. */
    events: z.array(RateLimitEvent),
  })
  .openapi("AdminHealth");
export type AdminHealth = z.infer<typeof AdminHealth>;
