---
paths:
  - "apps/server/src/**/*.ts"
  - "apps/server/test/**/*.ts"
---

# SQL queries stay parameterized

Every query goes through Kysely, and every value reaches Postgres as a bind parameter, never as
SQL text. Nothing a request, an MCP call, a job payload, the database, the environment or a file
supplies is ever written into a query's text. Keep it that way; when reviewing, treat a break of
any rule below as a bug.

## How to write a query

1. **Kysely's builder first** (`selectFrom`, `insertInto`, `updateTable`, `deleteFrom`, with
   `onConflict`, `returning` and so on) for ordinary reads and writes. Table types live in
   `src/db/schema.ts` and its sibling `*Schema.ts` files. Queries sit in a feature's store
   functions, which take `db` (or the `tx` of `db.transaction().execute`) as their first argument.
2. **The `sql` tagged template** only where the builder cannot say it: `FOR UPDATE SKIP LOCKED`,
   advisory locks, `make_interval`, `greatest(...)` in an upsert, trigram search and the like. Put
   every changing value in a `${…}` hole, which Kysely sends as a bind parameter; type the rows
   with `sql<Row>`; compose by nesting `sql` fragments (`src/downloads/rateLimits.ts`,
   `src/jobs/store.ts`).
3. **Never build SQL text from strings.**
   - no `+` or plain template literals forming SQL;
   - no `sql.raw(...)` of a string built at runtime;
   - no string queries to a `pg` client or pool, and no `CompiledQuery.raw`, except as in
     "Raw `pg` clients" below.

## Helpers that write text instead of binding

`sql.raw`, `sql.lit`, `sql.ref`, `sql.table` and `sql.id` put their argument into the SQL text.
They take only a value fixed in code: a literal, an `as const` list or map, a number computed in
code, or a union-typed value picked by a `switch`. When a request chooses a column, table or sort
order, it picks a contract enum and code maps that to a constant, as the sort switch in
`src/library/query.ts` does.

The approved uses today, all of them constants:

| Where                                                    | What                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/library/query.ts`                                   | `sql.raw(spec.dir)`, `"asc" \| "desc"` set by the sort switch     |
| `src/library/query.ts`, `src/library/search.ts`          | `sql.lit` of the tier constants                                   |
| `src/library/search.ts`, `src/subscriptions/patterns.ts` | `sql.raw(String(ms))` for `SET LOCAL statement_timeout`           |
| `src/sharing/people.ts`, `src/sharing/access.ts`         | `sql.table` of the `PeopleTable` union and its `SHARES` map       |
| `src/stats/stats.ts`                                     | `sql.ref` on the alias `"m"`                                      |
| `src/storage/measure.ts`                                 | `sql.table` and `sql.ref` from the `MEASURED` `as const` list     |
| `src/migrate/runner.ts`                                  | `sql.raw(file.sql)`, the shipped migration files and nothing else |

A new one goes into this table in the same change, with the reason it cannot be a parameter.

## Raw `pg` clients

Only the dedicated connections use `pg` directly: the pool's ping (`src/db/kysely.ts`), the
LISTEN/NOTIFY listener (`src/db/notifications.ts`, which `LISTEN`s only on the constant
`CHANNELS`), the migration connection (`src/migrate/onStart.ts`) and the leader lock
(`src/shared/leader.ts`). They send fixed strings, or `$1` parameters with a values array.

## Text a person typed

- Inside `LIKE` or `ILIKE`, pass it through `likePattern` (`src/library/searchTerms.ts`), which
  escapes `%`, `_` and `\`, and bind the result.
- A person's regular expression is a bind parameter to `~*`, run under
  `SET LOCAL statement_timeout` in its own transaction (`src/subscriptions/patterns.ts`), so a
  slow pattern times out instead of holding a replica.

## Schema changes

A schema change is a new migration from `mise run migration:new <name>` (never an edit to a
committed one) plus the matching change to the table types in `src/db/`. Migrations are plain SQL
and outside this rule.
