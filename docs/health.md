# Admin › Health

Admin › Health (`GET /api/admin/health`, admins only; `apps/server/src/health/`, the page in
`apps/web/src/admin/AdminHealthPage.tsx`) shows how the server is: which replicas run and how each
is, the version, and the rate limits sites put on it. The page reads it again every 10 s while it
is open. Every relative time on it ("2 minutes ago") shows the real date and time, in the browser's
own time zone, on hover, and swaps to it when clicked (another click swaps back).

## Replicas

Each replica checks in (`src/health/heartbeat.ts`) once it has migrated and attached its database:
at once, every 15 s, and whenever it starts or stops leading. It writes its row in `replicas`, an
unlogged table ([jobs.md](jobs.md#short-lived-state)):

- a random id for this process, its host (`os.hostname()`) and pid, which `jobs.worker` names its
  running jobs by (`host:pid`), and when it started;
- its version (`apps/server/package.json`, as `GET /api/info` reports it);
- whether it holds the leader lock (`URO_LEAD`);
- the checks of its own that fail: today `storage`, which fails when the store doesn't answer within
  2 s: S3 asked for a key that never exists, or a filesystem store whose folder is gone (not
  mounted, say).

Check-ins run one after another. Every check-in also drops the rows nobody has written for an
hour. A clean stop lets the check-in underway finish its checks without writing, then deletes the
replica's own row (within 4 s, before its connections close); a replica that died leaves its row,
which the page shows as not answering until it is dropped.

The page lists every replica in the table, the one that answered first:

| State         | When                                                          |
| ------------- | ------------------------------------------------------------- |
| Ready         | checked in within 45 s (three check-ins), no check failing    |
| Degraded      | checked in within 45 s, and a check fails (named, when known) |
| Not answering | no check-in for 45 s                                          |

Beside each are its version, whether it leads, when it started, the jobs it runs now and when it
last checked in. A replica that can't reach the database can't check in either, so it shows as not
answering; `GET /api/ready` on it says why. The tiles at the top count the replicas answering and
name the leader.

A newer replica may run a check this release has no name for; when it fails, the replica still
shows as degraded, the check unnamed. If a refresh of the page fails (a replica still starting, say)
it keeps what it read last and says when that was.

**Version.** The version shown is the answering replica's. While replicas run different versions
(a rollout underway) the page lists them. Replicas of the release before this page don't check in,
so during that one upgrade they aren't listed.

## Rate limits

**Rate limits now** lists every site's cooldown ([downloads.md](downloads.md#rate-limits)): the
site, whether it holds everything asked of it or only its subtitles, when it is asked again, the
limits in a row, and how many of the people's downloads and pasted links wait on it. A cooldown that
ran out stays, as "Over", until a request the site answers clears it.

**Recent rate limits** is a table of the newest 100 of the past week (`rate_limit_events`, which
`noteRateLimit` writes in the same statement that records each cooldown; the leader's sweeper drops
those older than 7 days). Each row says:

- when it happened: how long ago, counting up to the second while the page is open ("4 min 12 s
  ago", then hours and minutes, days and hours), above the time of day;
- the video, by its title (or link) to the site, when known. Subtitles fetched apart and a hover
  preview's copy are for a video already stored (`media_id`; a limit on a fetch's subtitles names
  it once the fetch stores the video): when you hold it, the link opens it in your library
  instead;
- the site, and the kind of work the limit held: a download, a pasted link's check, a search, a
  subscription check, a hover preview, or subtitles;
- yt-dlp's message, its last `ERROR:` line, redacted as every stderr line is, up to 1000
  characters (a NUL, which a text column refuses, dropped);
- the cooldown it set: how long, whether the site said so or it is the estimate (and the limits in
  a row), and when the site is asked again. A longer cooldown already running stands, and then the
  wait isn't the site's.

Only a site's real answers are logged, not the passes that wait out a cooldown, so a held playlist
logs one limit, not one per video. The log names no one: a limit is on the server, not a person.
The people whose downloads, links or subtitles a limit holds are told in their bell
([push.md](push.md#the-list-in-the-app)).
