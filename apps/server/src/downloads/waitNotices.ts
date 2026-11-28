import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { fileNoticesOnce } from "../notices/store.ts";
import type { Message } from "../push/pusher.ts";
import { publishDownloadEvents } from "./events.ts";

/**
 * A person's item held by a site's rate limit (docs/downloads.md "Rate limits"): each waiting
 * download, each waiting pasted link, and each download whose subtitles wait gets one entry in its
 * person's bell, never pushed. Told once: the passes that wait out a cooldown come back here and
 * file nothing more.
 */

const body = (site: string) => `${site} is limiting requests. It will try again on its own.`;

/** What the waiting is about: a search names its query (YouTube's `search_query`). */
function linkTitle(url: string, intent: string): string {
  if (intent === "search") {
    let query: string | null = null;
    try {
      query = new URL(url).searchParams.get("search_query");
    } catch {
      // Not a link: named as it is.
    }
    if (query !== null) return `Waiting: search for "${query}"`;
  }
  return `Waiting: ${url}`;
}

async function fileOnce(
  db: Kysely<Database>,
  notices: { userId: string; message: Message & { tag: string } }[],
): Promise<void> {
  const told = await fileNoticesOnce(
    db,
    notices.map((n) => ({ ...n, kind: "downloads" as const })),
  );
  await publishDownloadEvents(
    db,
    [...new Set(told)].map((userId) => ({ kind: "notice" as const, userId })),
  );
}

/** Each held download's person hears that it waits on `site`. */
export function noticeHeldDownloads(
  db: Kysely<Database>,
  rows: readonly { id: string; user_id: string; title: string | null; url: string }[],
  site: string,
): Promise<void> {
  return fileOnce(
    db,
    rows.map((r) => ({
      userId: r.user_id,
      message: {
        title: `Waiting: ${r.title ?? r.url}`,
        body: body(site),
        path: "/downloads",
        tag: `rate-limit:download:${r.id}`,
      },
    })),
  );
}

/** A held pasted link's (or search's) person hears that it waits on `site`. */
export function noticeHeldRequest(
  db: Kysely<Database>,
  req: { id: string; user_id: string; url: string; intent: string },
  site: string,
): Promise<void> {
  return fileOnce(db, [
    {
      userId: req.user_id,
      message: {
        title: linkTitle(req.url, req.intent),
        body: body(site),
        path: "/downloads",
        tag: `rate-limit:request:${req.id}`,
      },
    },
  ]);
}

/**
 * Each person whose download was stored without its subtitles, which `site` limited, hears they
 * come later; the entry opens the video in their library.
 */
export function noticeHeldSubtitles(
  db: Kysely<Database>,
  rows: readonly { id: string; user_id: string; title: string; entry_id: string | null }[],
  site: string,
): Promise<void> {
  return fileOnce(
    db,
    rows.map((r) => ({
      userId: r.user_id,
      message: {
        title: `Subtitles waiting: ${r.title}`,
        body: `${site} is limiting requests for subtitles. They'll be added on their own.`,
        path: r.entry_id === null ? "/" : `/library/${r.entry_id}`,
        tag: `rate-limit:subtitles:${r.id}`,
      },
    })),
  );
}
