# Jobs and messages on Postgres

Uroboros runs on Postgres alone: its background jobs, the messages its replicas send each other,
and the short-lived state they share all live in the one database. This page is the design. The
download, playback and automation pages ([downloads.md](downloads.md),
[transcoding.md](transcoding.md), [automation.md](automation.md)) say what each feature does with it.

## Messages between replicas

`src/db/notifications.ts` carries messages over Postgres's LISTEN/NOTIFY, as Djinn's `live.rs` does.

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
