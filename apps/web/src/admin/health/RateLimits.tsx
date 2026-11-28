import type { RateLimitEvent, SiteCooldown } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/subscriptions/format";

import { At } from "./At";
import {
  SCOPE_NAME,
  SOURCE_NAME,
  cell,
  clock,
  elapsed,
  formatWait,
  head,
  num,
  row,
  waitingText,
} from "./format";

function CooldownRow({ cooldown: c, now }: { cooldown: SiteCooldown; now: number }) {
  return (
    <tr className={row}>
      <td className={`${cell} font-medium`}>{c.site}</td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Holds: </span>
        {SCOPE_NAME[c.scope]}
      </td>
      <td className={cell}>
        <Badge tone={c.active ? "warning" : "muted"}>{c.active ? "Limiting" : "Over"}</Badge>
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Asked again: </span>
        {clock(c.until)}
        <span className="text-muted-foreground">
          {" · "}
          <At iso={c.until}>{relativeTime(c.until, now)}</At>
        </span>
      </td>
      <td className={num}>
        <span className="text-muted-foreground md:sr-only">Limits in a row: </span>
        {c.strikes.toLocaleString()}
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Waiting: </span>
        {waitingText(c.waitingDownloads, c.waitingLinks)}
      </td>
    </tr>
  );
}

/**
 * Each site's cooldown (docs/downloads.md "Rate limits"): what it holds, when the site is asked
 * again, the limits in a row, and the people's downloads and links waiting on it. One that ran out
 * stays until the site answers a request.
 */
export function Cooldowns({ cooldowns, now }: { cooldowns: readonly SiteCooldown[]; now: number }) {
  return (
    <section aria-labelledby="health-cooldowns" className="grid gap-3">
      <h2 id="health-cooldowns" className="text-base font-bold">
        Rate limits now
      </h2>
      {cooldowns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No site is limiting requests.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="health-cooldowns" className="w-full text-left text-sm">
            <thead className="max-md:sr-only">
              <tr>
                <th className={head}>Site</th>
                <th className={head}>Holds</th>
                <th className={head}>Status</th>
                <th className={head}>Asked again</th>
                <th className={`${head} text-right`}>Limits in a row</th>
                <th className={head}>Waiting</th>
              </tr>
            </thead>
            <tbody className="max-md:grid">
              {cooldowns.map((c) => (
                <CooldownRow key={`${c.site} ${c.scope}`} cooldown={c} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The video a limit held: a stored one the viewer holds opens in their library; otherwise its title
 * (or link) goes to the site; or nothing is known.
 */
function Video({ event: e }: { event: RateLimitEvent }) {
  if (e.entryId !== null) {
    return (
      <Link
        to="/library/$entryId"
        params={{ entryId: e.entryId }}
        className="break-words text-primary hover:underline"
      >
        {e.title ?? e.url ?? "The video"}
      </Link>
    );
  }
  if (e.url === null) return <span>{e.title ?? "No video"}</span>;
  return (
    <a
      href={e.url}
      target="_blank"
      rel="noreferrer"
      // A title wraps between words; a bare link has none to wrap at.
      className={cn("text-primary hover:underline", e.title === null ? "break-all" : "break-words")}
    >
      {e.title ?? e.url}
    </a>
  );
}

/** Whose wait the cooldown is: "as the site said", or "estimated · 3 in a row". */
function cooldownNote(e: RateLimitEvent): string {
  const how = e.hinted ? "as the site said" : "estimated";
  return e.strikes > 1 ? `${how} · ${String(e.strikes)} in a row` : how;
}

function EventRow({ event: e, now }: { event: RateLimitEvent; now: number }) {
  return (
    <tr className={row}>
      <td className={`${cell} whitespace-nowrap`}>
        <At iso={e.at} className="font-medium tabular-nums">
          {elapsed(now - new Date(e.at).getTime())}
        </At>
        <span className="block text-xs text-muted-foreground">{clock(e.at)}</span>
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Site: </span>
        {e.site}
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Work: </span>
        {SOURCE_NAME[e.source]}
        {e.scope === "subtitles" && e.source !== "subtitles" ? " (subtitles)" : ""}
      </td>
      <td className={`${cell} md:min-w-40 md:max-w-60`}>
        <span className="text-muted-foreground md:sr-only">Video: </span>
        <Video event={e} />
      </td>
      <td className={`${cell} md:min-w-64`}>
        <p className="font-mono text-xs break-words">{e.message}</p>
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        <span className="text-muted-foreground md:sr-only">Cooldown: </span>
        {formatWait(new Date(e.until).getTime() - new Date(e.at).getTime())}
        <span className="block text-xs text-muted-foreground max-md:ml-1 max-md:inline">
          {cooldownNote(e)}
        </span>
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        <span className="text-muted-foreground md:sr-only">Retries at: </span>
        {clock(e.until)}
      </td>
    </tr>
  );
}

/**
 * The rate limits of the past week, newest first: when (counting up, to the second), the site, the
 * work it held and its video, the site's words, and the cooldown it set.
 */
export function RateLimitLog({ events }: { events: readonly RateLimitEvent[] }) {
  const now = useNow(1000);
  return (
    <section aria-labelledby="health-log" className="grid gap-3">
      <h2 id="health-log" className="text-base font-bold">
        Recent rate limits
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No site limited requests in the past week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="health-log" className="w-full text-left text-sm">
            <thead className="max-md:sr-only">
              <tr>
                <th className={head}>When</th>
                <th className={head}>Site</th>
                <th className={head}>Work</th>
                <th className={head}>Video</th>
                <th className={head}>Message</th>
                <th className={head}>Cooldown</th>
                <th className={head}>Retries at</th>
              </tr>
            </thead>
            <tbody className="max-md:grid">
              {events.map((e) => (
                <EventRow key={e.id} event={e} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
