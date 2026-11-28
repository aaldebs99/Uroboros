# Jobs and messages on Postgres

Uroboros runs on Postgres alone: its background jobs, the messages its replicas send each other,
and the short-lived state they share all live in the one database. This page is the design. The
download, playback, automation and upload pages ([downloads.md](downloads.md),
[transcoding.md](transcoding.md), [automation.md](automation.md), [uploads.md](uploads.md)) say
what each feature does with it.

## The job queue

Background work runs as jobs in `src/jobs/`. Each job is a row in `jobs`, waiting (`queued`, due at
`run_at`) or running. A finished job's row is deleted, so every row is live.

| Queue        | Runs                                                       | Lease | Stalls before it is dropped |
| ------------ | ---------------------------------------------------------- | ----- | --------------------------- |
| `probe`      | a pasted link's probe, or a SponsorBlock refetch (`skips`) | 30 s  | 1                           |
| `download`   | a fetch, shared by everyone waiting                        | 60 s  | 2                           |
| `notify`     | a push notification                                        | 30 s  | 1                           |
| `playback`   | a playback session's runner                                | 60 s  | 1                           |
| `automation` | a subscription check, or its "latest"                      | 30 s  | 1                           |
| `upload`     | filing a finished upload                                   | 60 s  | 2                           |
| `export`     | a copy without SponsorBlock segments                       | 60 s  | 1                           |
| `preview`    | a video's hover preview clip                               | 60 s  | 1                           |

**Adding.** `JobQueue.add(name, data, {key, delayMs, attempts, backoff}, on?)` inserts the row and
wakes the workers on `uroboros_jobs`.

- **Keys.** A job may carry a key, and a second job with the key of a live one is refused. That is
  how two people asking for the same video share one fetch. Once the job is gone, the key can be
  used again.
- **Transactions.** Given a transaction, the job and its wake commit with the caller's rows, or
  neither does. A dispatch and its fetch, or a pasted link and its probe, can't come apart.

**Running.** Each process runs one runner per queue it consumes. A runner:

1. **Claims** up to its free slots of due jobs, oldest first, in one statement (`FOR UPDATE SKIP
   LOCKED`), so two replicas never take the same job. The claim counts an attempt and gives the run
   a lease: a random token (`locked_by`) valid until `locked_until`. It commits at once, and no
   connection is held while the job runs.
2. **Renews** the leases of its running jobs every half lease.
3. **Records** how each run ended. Every write is fenced by the run's token, so a run that lost its
   job writes nothing:
   - it finished: the row is deleted;
   - it threw: the job goes back for a retry after its backoff (fixed, or doubling with each failed
     run), until its attempts are spent and it is dropped;
   - it threw `UnrecoverableError`: the job is dropped at once;
   - it threw `RequeueError`: the job goes back without spending the attempt (a shutdown cut).
4. **Sleeps** until the next job is due, at most 5 s. It wakes early on a `uroboros_jobs` message
   for its queue, after the listener reconnects, or when a slot frees.

**Rate limit.** The automation queue starts at most one job every 2 s across every replica, through
the `job_limits` row its claims update.

**Stalls.** A worker that crashed leaves its jobs running with leases that lapse. Every 15 s the
leader puts them back, giving each run's attempt back and counting a stall. A job past its queue's
stalls is dropped, and the leader's reconcilers re-add the downloads and playback sessions that
still need one.

**Shutdown.** A stopping replica stops claiming and lets its running jobs end, cutting fetches and
playback runs 5 s before its grace so they go back to the queue. Past the grace it puts the jobs
still running back at once, as stalls.

## Messages between replicas

`src/db/notifications.ts` carries messages over Postgres's LISTEN/NOTIFY.

- **Sending.** `notify(db, channel, payload)` sends a payload under 8000 bytes.
  - Inside a transaction it goes out when that transaction commits, and never after a rollback.
  - On the pool it is a transaction of its own, committed without waiting for the WAL flush. A
    message is ephemeral, and a shorter commit holds Postgres's notify lock for less time.
- **Listening.** Every process keeps **one listener connection** (`application_name`
  `uroboros:listen`), outside the pool and never in a transaction. It LISTENs on every channel and
  hands each payload to the listeners registered in the process. That includes payloads the process
  sent itself: its own listener hears its pool's notifies like any other.
- **Keeping it alive.** The listener pings its connection every 10 s. When the connection drops, the
  listener dials again, backing off from 1 s and doubling up to 30 s.
- **Resync.** Whatever was sent while the listener was away is lost, so every reconnect tells the
  resync listeners, and each feature catches up its own way:
  - live download pages end their streams, so the browser refetches;
  - job runners look for work at once.

| Channel              | Carries                                                |
| -------------------- | ------------------------------------------------------ |
| `uroboros_jobs`      | a queue's name, when a job became due there            |
| `uroboros_downloads` | download state and progress events, for the live pages |
| `uroboros_cancel`    | a fetch key whose download nobody wants any more       |
| `uroboros_playback`  | the playback bus: segment wants, segments ready, stops |

NOTIFY reaches only the sessions of the same database, so every test database is isolated by
construction.

## Short-lived state

What replicas share for minutes, not for good, lives in **unlogged** tables. They skip the WAL, so
writes are cheap, and a crash empties them, which costs each one little:

| Table               | Holds                                                               | After a crash                    |
| ------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `job_limits`        | when a rate-limited queue may start its next job                    | one job may start early          |
| `download_progress` | a running fetch's latest progress, kept a minute                    | it fills again                   |
| `signin_failures`   | failed sign-ins in their 15-minute window, per user and IP          | the windows start over           |
| `playback_live`     | a live session's viewer deadline and owning run's token             | pages start their sessions again |
| `playback_segments` | the segments a live session has stored                              | (with its session)               |
| `replicas`          | each replica's check-in for Admin › Health ([health.md](health.md)) | each checks in again within 15 s |

Readers skip expired rows, and the leader's hourly sweep deletes them. The playback tables go with
their session's row. `replicas` rows unseen for an hour go at every replica's check-in instead
(`beat` in `src/health/heartbeat.ts`), and a replica that stops cleanly deletes its own.
