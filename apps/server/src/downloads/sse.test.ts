import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { cutListeners, testBus } from "../../test/bus.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { PgBus } from "../db/notifications.ts";
import { queuePreview } from "../previews/queue.ts";
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

type StreamEvent = { type: string; [k: string]: unknown };

const sleep = (ms: number) =>
  new Promise<null>((r) => {
    setTimeout(() => {
      r(null);
    }, ms);
  });

/**
 * A caller's open event stream, read here. Markers are SponsorBlock nudges of the viewer's own
 * with a fresh entry id (error "marker"), which every stream of theirs is sent: `listening` sends
 * one until it comes through, so the stream is surely subscribed before the test publishes, and
 * `around` closes what it collects with another, so an event that should not arrive is not merely
 * late.
 */
function stream(res: Response, viewer: SignedIn) {
  const reader = (res.body ?? new ReadableStream<Uint8Array>()).getReader();
  const decoder = new TextDecoder();
  const seen: StreamEvent[] = [];
  let buffer = "";
  // One read at a time: a read that outlasts a wait is kept for the next, never dropped.
  let pending: Promise<{ done: boolean; value?: Uint8Array }> | null = null;

  /** Reads what arrives within `ms`; false once the stream has ended. */
  async function pull(ms: number): Promise<boolean> {
    pending ??= reader.read();
    const chunk = await Promise.race([pending, sleep(ms)]);
    if (chunk === null) return true;
    pending = null;
    if (chunk.done) return false;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) seen.push(JSON.parse(line.slice(6)) as StreamEvent);
    }
    return true;
  }

  async function marker(): Promise<string> {
    const entryId = randomUUID();
    await publishDownloadEvent(testDb.db, {
      kind: "skips",
      userId: viewer.userId,
      entryId,
      found: null,
      error: "marker",
    });
    return entryId;
  }
  const at = (entryId: string) =>
    seen.findIndex((e) => e.type === "skips" && e.entryId === entryId);

  return {
    async listening(): Promise<void> {
      const deadline = Date.now() + 5000;
      for (;;) {
        const id = await marker();
        const wait = Date.now() + 300;
        while (Date.now() < wait && at(id) === -1) await pull(50);
        if (at(id) !== -1) return;
        if (Date.now() > deadline) throw new Error("the stream never started listening");
      }
    },
    /** Every event sent after `publish` starts, up to a closing marker; markers left out. */
    async around(publish: () => Promise<unknown>): Promise<StreamEvent[]> {
      const from = seen.length;
      await publish();
      const id = await marker();
      const deadline = Date.now() + 5000;
      while (at(id) === -1) {
        if (Date.now() > deadline) throw new Error("the closing marker never came");
        if (!(await pull(100))) throw new Error("the stream ended");
      }
      return seen.slice(from, at(id)).filter((e) => !(e.type === "skips" && e.error === "marker"));
    },
    /** Resolves once the server ends the stream. */
    async ended(): Promise<void> {
      while (await pull(1000));
    },
    cancel: () => reader.cancel(),
  };
}

/** Opens `res`'s stream for `viewer` and returns everything `publish` makes it send. */
async function collect(res: Response, viewer: SignedIn, publish: () => Promise<unknown>) {
  const s = stream(res, viewer);
  try {
    await s.listening();
    return await s.around(publish);
  } finally {
    await s.cancel();
  }
}

const user = () => signedIn(testDb.db, { username: `sse${String(++n)}` });

describe("GET /api/downloads/events", () => {
  it("sends a member their own state changes and nobody else's", async () => {
    const [a, b] = [await user(), await user()];
    const mine = await queued(a.userId, "sse-a");
    const theirs = await queued(b.userId, "sse-b");
    const res = await app(a).request("/api/downloads/events");
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await collect(res, a, async () => {
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
    });
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
      admin,
      () =>
        publishDownloadEvent(testDb.db, {
          kind: "state",
          downloadId: d.id,
          userId: a.userId,
        }),
    );
    expect(events).toMatchObject([{ type: "state", download: { id: d.id } }]);
  });

  it("nudges a person, an admin's everyone view included, only about their own notices", async () => {
    const [a, b] = [
      await user(),
      await signedIn(testDb.db, { username: `ssenot${String(++n)}`, role: "admin" }),
    ];
    const events = await collect(
      await app(b).request("/api/downloads/events?all=true"),
      b,
      async () => {
        await publishDownloadEvent(testDb.db, { kind: "notice", userId: a.userId });
        await publishDownloadEvent(testDb.db, { kind: "notice", userId: b.userId });
      },
    );
    expect(events).toEqual([{ type: "notice" }]);
  });

  it("nudges only its person, an admin's everyone view included, when their previews waiting for a pick change", async () => {
    const [a, b] = [
      await user(),
      await signedIn(testDb.db, { username: `ssereq${String(++n)}`, role: "admin" }),
    ];
    const events = await collect(
      await app(b).request("/api/downloads/events?all=true"),
      b,
      async () => {
        await publishDownloadEvent(testDb.db, { kind: "requests", userId: a.userId });
        await publishDownloadEvent(testDb.db, { kind: "requests", userId: b.userId });
      },
    );
    expect(events).toEqual([{ type: "requests" }]);
  });

  it("nudges only its person, an admin's everyone view included, when an upload of theirs is filed", async () => {
    const [a, b] = [
      await user(),
      await signedIn(testDb.db, { username: `sselib${String(++n)}`, role: "admin" }),
    ];
    const events = await collect(
      await app(b).request("/api/downloads/events?all=true"),
      b,
      async () => {
        await publishDownloadEvent(testDb.db, { kind: "library", userId: a.userId });
        await publishDownloadEvent(testDb.db, { kind: "library", userId: b.userId });
      },
    );
    expect(events).toEqual([{ type: "library" }]);
  });

  it("nudges only the people who have a video when its preview is queued", async () => {
    const [a, b] = [await user(), await user()];
    const [first, second] = [
      await seedEntry(testDb.db, a.userId),
      await seedEntry(testDb.db, a.userId),
    ];
    const mine = await collect(await app(a).request("/api/downloads/events"), a, () =>
      queuePreview(h.ctx, first.mediaId),
    );
    expect(mine).toEqual([{ type: "previews" }]);
    // Then, in order: a's nudge, and b's own notice. b's stream hears only the notice.
    const theirs = await collect(await app(b).request("/api/downloads/events"), b, async () => {
      await queuePreview(h.ctx, second.mediaId);
      await publishDownloadEvent(testDb.db, { kind: "notice", userId: b.userId });
    });
    expect(theirs).toEqual([{ type: "notice" }]);
  });

  it("tells only its person, an admin's everyone view included, how a SponsorBlock refetch went", async () => {
    const [a, b] = [
      await user(),
      await signedIn(testDb.db, { username: `ssesk${String(++n)}`, role: "admin" }),
    ];
    const [entryA, entryB] = [randomUUID(), randomUUID()];
    const events = await collect(
      await app(b).request("/api/downloads/events?all=true"),
      b,
      async () => {
        await publishDownloadEvent(testDb.db, {
          kind: "skips",
          userId: a.userId,
          entryId: entryA,
          found: 2,
          error: null,
        });
        await publishDownloadEvent(testDb.db, {
          kind: "skips",
          userId: b.userId,
          entryId: entryB,
          found: null,
          error: "yt-dlp failed",
        });
      },
    );
    expect(events).toEqual([
      {
        type: "skips",
        entryId: entryB,
        found: null,
        error: "yt-dlp failed",
        total: null,
        highlight: false,
        quiet: false,
      },
    ]);
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
    const events = await collect(await app(a).request("/api/downloads/events"), a, async () => {
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
    });
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
            Promise.resolve({
              userId: a.userId,
              tokenId: "0190a3f2-7c1e-7000-8000-0000000000ff",
              scopes: ["api"],
              readOnly: false,
            }),
        },
      },
      { webDist: null },
    ).request("/api/downloads/events", { headers: { authorization: `Bearer ${"a".repeat(64)}` } });
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
  it("ends every open stream when the listener reconnects, so pages refetch", async () => {
    const a = await user();
    const s = stream(await app(a).request("/api/downloads/events"), a);
    await s.listening();
    expect(await cutListeners(testDb.db)).toBe(1);
    await s.ended();
  });
});
