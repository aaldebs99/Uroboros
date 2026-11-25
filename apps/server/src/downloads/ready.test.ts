import { randomUUID } from "node:crypto";
import { DownloadRequest, ReadyPreview } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let bus: PgBus;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  bus = testBus(testDb);
  await bus.ready;
});
afterAll(async () => {
  await bus.close();
  await h.close();
  await testDb.close();
});

const person = (): Promise<SignedIn> => signedIn(testDb.db, { username: `ready${String(++n)}` });

const entry = (id: string) => ({
  id,
  extractor: "youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Video ${id}`,
  duration: 10,
  uploader: "Blender",
  thumbnailUrl: null,
});

/** A preview the probe made: one group per `groups` entry, ticked or not. */
async function preview(
  userId: string,
  groups: { ids: string[]; ticked: boolean }[],
  columns: {
    intent?: "download" | "subscribe" | "search";
    state?: "choosing" | "queued";
    expires_at?: Date;
    title?: string;
  } = {},
): Promise<string> {
  const row = await testDb.db
    .insertInto("download_requests")
    .values({
      user_id: userId,
      url: `https://www.youtube.com/playlist?list=${randomUUID()}`,
      profile_id: (await seededDefault(testDb.db)).id,
      state: "choosing",
      kind: "playlist",
      title: "A playlist",
      entries: JSON.stringify(
        groups.map((g, i) => ({
          name: `Group ${String(i)}`,
          ticked: g.ticked,
          truncated: false,
          entries: g.ids.map(entry),
        })),
      ),
      ...columns,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const put = (s: SignedIn, id: string, entryIds: string[]) =>
  h.app(s).request(`/api/downloads/requests/${id}/selection`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryIds }),
  });

const read = async (s: SignedIn, id: string) =>
  DownloadRequest.parse(await (await h.app(s).request(`/api/downloads/requests/${id}`)).json());

const ready = async (s: SignedIn) => {
  const res = await h.app(s).request("/api/downloads/requests");
  expect(res.status).toBe(200);
  return z.array(ReadyPreview).parse(await res.json());
};

describe("PUT /api/downloads/requests/{id}/selection", () => {
  it("keeps the person's picks on the request, until they change them", async () => {
    const alice = await person();
    const id = await preview(alice.userId, [{ ids: ["a1", "a2", "a3"], ticked: true }]);
    expect((await read(alice, id)).selected).toBeNull();
    expect((await put(alice, id, ["a1", "a3"])).status).toBe(204);
    expect((await read(alice, id)).selected).toEqual(["a1", "a3"]);
    expect((await put(alice, id, [])).status).toBe(204);
    expect((await read(alice, id)).selected).toEqual([]);
  });

  it("refuses what isn't in the preview (400), a preview already queued (409), and another person's (404)", async () => {
    const [alice, bob] = [await person(), await person()];
    const id = await preview(alice.userId, [{ ids: ["r1"], ticked: true }]);
    expect((await put(alice, id, ["zzz"])).status).toBe(400);
    const queued = await preview(alice.userId, [{ ids: ["r2"], ticked: true }], {
      state: "queued",
    });
    expect((await put(alice, queued, ["r2"])).status).toBe(409);
    expect((await put(bob, id, ["r1"])).status).toBe(404);
    expect((await read(alice, id)).selected).toBeNull();
  });
});

describe("GET /api/downloads/requests", () => {
  it("lists the person's previews still waiting for a pick, newest first, with how many are picked", async () => {
    const [alice, bob] = [await person(), await person()];
    const older = await preview(
      alice.userId,
      [
        { ids: ["v1", "v2"], ticked: true },
        { ids: ["s1", "s2", "s3"], ticked: false },
      ],
      { title: "A channel" },
    );
    const newer = await preview(alice.userId, [{ ids: ["p1", "p2", "p3"], ticked: true }]);
    await put(alice, newer, ["p2"]);
    // Not waiting on a pick: a search's results, a link to subscribe to, one already queued, one
    // past its day, and someone else's.
    await preview(alice.userId, [{ ids: ["x1"], ticked: false }], { intent: "search" });
    await preview(alice.userId, [{ ids: ["x2"], ticked: true }], { intent: "subscribe" });
    await preview(alice.userId, [{ ids: ["x3"], ticked: true }], { state: "queued" });
    await preview(alice.userId, [{ ids: ["x4"], ticked: true }], {
      expires_at: new Date(Date.now() - 1000),
    });
    await preview(bob.userId, [{ ids: ["x5"], ticked: true }]);
    const listed = await ready(alice);
    expect(listed.map((p) => [p.id, p.title, p.entries, p.selected])).toEqual([
      [newer, "A playlist", 3, 1],
      [older, "A channel", 5, 2],
    ]);
    expect(new Date(listed[0]?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it("drops a preview once it is queued, and says so to the person's open tabs", async () => {
    const alice = await person();
    const id = await preview(alice.userId, [{ ids: ["g1"], ticked: true }]);
    expect((await ready(alice)).map((p) => p.id)).toEqual([id]);
    // Everything said on the channel: the queued download's own state events come too.
    const messages: unknown[] = [];
    const off = bus.on("uroboros_downloads", (payload) => messages.push(JSON.parse(payload)));
    try {
      await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: ["g1"] });
      await vi.waitFor(() => {
        expect(messages).toContainEqual({ kind: "requests", userId: alice.userId });
      });
    } finally {
      off();
    }
    expect(await ready(alice)).toEqual([]);
  });
});

describe("a preview past its day", () => {
  it("is gone at once, before the sweeper deletes it: 404 to read, pick from or queue", async () => {
    const alice = await person();
    const id = await preview(alice.userId, [{ ids: ["e1"], ticked: true }], {
      expires_at: new Date(Date.now() - 1000),
    });
    expect((await h.app(alice).request(`/api/downloads/requests/${id}`)).status).toBe(404);
    expect((await put(alice, id, ["e1"])).status).toBe(404);
    expect(
      (await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: ["e1"] }))
        .status,
    ).toBe(404);
  });

  it("still reads when it was queued, since only a preview waiting for a pick expires", async () => {
    const alice = await person();
    const id = await preview(alice.userId, [{ ids: ["k1"], ticked: true }], {
      state: "queued",
      expires_at: new Date(Date.now() - 1000),
    });
    expect((await read(alice, id)).state).toBe("queued");
  });
});
