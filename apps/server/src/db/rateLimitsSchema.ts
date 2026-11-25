import type { ColumnType } from "kysely";

/** The rate-limit table (docs/downloads.md "Rate limits"), kept apart from schema.ts. */

/** `site_cooldowns`: a site limiting this server's requests, and until when nothing is asked of it. */
export interface SiteCooldownsTable {
  site: string;
  scope: "site" | "subtitles";
  until: ColumnType<Date, Date | string, Date | string>;
  strikes: number;
}
