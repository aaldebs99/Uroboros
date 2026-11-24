import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { cutListeners, testBus } from "../../test/bus.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { PgBus } from "../db/notifications.ts";
import { queueDownload } from "./dispatch.ts";
import { publishDownloadEvent } from "./events.ts";
import { createEventHub, type EventHub } from "./sse.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let hub: EventHub;
let bus: PgBus;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  bus = testBus(testDb);
  hub = createEventHub(bus, logger);
  await hub.ready;
});
afterAll(async () => {
  hub.close();
  await bus.close();
  await h.close();
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(
    createApp(
      {
        db: testDb.db,
        version: "t",
        logger,
        downloads: h.ctx,
        downloadEvents: hub,
      },
      { webDist: null },
    ),
    s,
  );

async function queued(userId: string, videoId: string): Promise<{ id: string; fetchKey: string }> {
  const profile = await seededDefault(testDb.db);
  const out = await testDb.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId,
      requestId: null,
      extractor: "youtube",
      videoId,
      url: "https://x.example/v",
      title: videoId,
      profile,
    }),
  );
  const row = await testDb.db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("id", "=", out.downloadId ?? "")
    .executeTakeFirstOrThrow();
  return { id: out.downloadId ?? "", fetchKey: row.fetch_key };
}

/** Opens the stream and collects its data lines until `stop` returns true or 3 s pass. */
async function collect(
  res: Response,
  publish: () => Promise<void>,
  stop: (events: { type: string }[]) => boolean,
) {
  const reader = (res.body ?? new ReadableStream<Uint8Array>()).getReader();
  const decoder = new TextDecoder();
  const events: { type: string; [k: string]: unknown }[] = [];
  let buffer = "";
  await new Promise((r) => setTimeout(r, 100));
  await publish();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !stop(events)) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => {
        setTimeout(() => {
          r({ done: true, value: undefined });
        }, 300);
      }),
    ]);
    const bytes = chunk.value as Uint8Array | undefined;
    if (bytes !== undefined) buffer += decoder.decode(bytes);
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)) as { type: string });
    }
    buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
  }
  await reader.cancel();
  return events;
}

const user = () => signedIn(testDb.db, { username: `sse${String(++n)}` });

describe("GET /api/downloads/events", () => {
  it("sends a member their own state changes and nobody else's", async () => {
    const [a, b] = [await user(), await user()];
    const mine = await queued(a.userId, "sse-a");
    const theirs = await queued(b.userId, "sse-b");
    const res = await app(a).request("/api/downloads/events");
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await collect(
      res,
      async () => {
        await publishDownloadEvent(testDb.db, {
          kind: "state",
          downloadId: theirs.id,
          userId: b.userId,
        });
        await publishDownloadEvent(testDb.db, {
          kind: "state",
          downloadId: mine.id,
          userId: a.userId,
        });
      },
      (e) => e.length >= 1,
    );
    expect(events.map((e) => (e as { download?: { id: string } }).download?.id)).toEqual([mine.id]);
  });

  it("sends an admin everyone's with all=true, and refuses all=true for a member", async () => {
    const [a, admin] = [
      await user(),
      await signedIn(testDb.db, { username: `sseadm${String(++n)}`, role: "admin" }),
    ];
    const d = await queued(a.userId, "sse-adm");
    expect((await app(a).request("/api/downloads/events?all=true")).status).toBe(403);
    const events = await collect(
      await app(admin).request("/api/downloads/events?all=true"),
      () =>
        publishDownloadEvent(testDb.db, {
          kind: "state",
          downloadId: d.id,
          userId: a.userId,
        }),
      (e) => e.length >= 1,
    );
    expect(events[0]).toMatchObject({ type: "state" });
  });

  it("forwards progress only for fetches the caller waits on", async () => {
    const a = await user();
    const d = await queued(a.userId, "sse-prog");
    const progress = {
      phase: "downloading" as const,
      percent: 50,
      downloadedBytes: 5,
      totalBytes: 10,
      speed: 1,
      eta: 5,
    };
    const events = await collect(
      await app(a).request("/api/downloads/events"),
      async () => {
        await publishDownloadEvent(testDb.db, {
          kind: "progress",
          fetchKey: "fetch|other",
          progress,
        });
        await publishDownloadEvent(testDb.db, {
          kind: "progress",
          fetchKey: d.fetchKey,
          progress,
        });
      },
      (e) => e.length >= 1,
    );
    expect(events).toEqual([{ type: "progress", fetchKey: d.fetchKey, progress }]);
  });

  it("lets an API token read the stream", async () => {
    const a = await user();
    const res = await createApp(
      {
        db: testDb.db,
        version: "t",
        logger,
        downloads: h.ctx,
        downloadEvents: hub,
        auth: {
          secureCookies: false,
          resolveToken: () =>
            Promise.resolve({ userId: a.userId, tokenId: "0190a3f2-7c1e-7000-8000-0000000000ff" }),
        },
      },
      { webDist: null },
    ).request("/api/downloads/events", { headers: { authorization: `Bearer ${"a".repeat(64)}` } });
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
  it("ends every open stream when the listener reconnects, so pages refetch", async () => {
    const a = await user();
    const res = await app(a).request("/api/downloads/events");
    const reader = (res.body ?? new ReadableStream<Uint8Array>()).getReader();
    await new Promise((r) => setTimeout(r, 100));
    expect(await cutListeners(testDb.db)).toBe(1);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
    }
  });
});
