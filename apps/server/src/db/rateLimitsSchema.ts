import type { ColumnType, Generated } from "kysely";

/** The rate-limit tables (docs/downloads.md "Rate limits"), kept apart from schema.ts. */

/** `site_cooldowns`: a site limiting this server's requests, and until when nothing is asked of it. */
export interface SiteCooldownsTable {
  site: string;
  scope: "site" | "subtitles";
  until: ColumnType<Date, Date | string, Date | string>;
  strikes: number;
}

/** What kind of work a site's rate limit held. */
export type RateLimitSourceValue =
  | "download"
  | "link"
  | "search"
  | "subscription"
  | "preview"
  | "subtitles";

/** `rate_limit_events`: each rate limit a site answered with, for the admin; kept a week. */
export interface RateLimitEventsTable {
  id: Generated<string>;
  at: ColumnType<Date, Date | string | undefined, Date | string>;
  site: string;
  scope: "site" | "subtitles";
  source: RateLimitSourceValue;
  message: string;
  url: string | null;
  title: string | null;
  /** The stored video it held (subtitles fetched apart, a hover preview's copy). */
  media_id: ColumnType<string | null, string | null | undefined, string | null>;
  until: ColumnType<Date, Date | string, Date | string>;
  hinted: boolean;
  strikes: number;
}
