import { randomUUID } from "node:crypto";
import { SubscriptionItemsPage } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { insertSubscription } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { ITEMS_PAGE_SIZE } from "./items.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let profileId: string;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

async function person(): Promise<SignedIn> {
  return signedIn(t.db, { username: `items${String(++n)}` });
}

async function subscription(s: SignedIn): Promise<string> {
  return insertSubscription(t.db, {
    userId: s.userId,
    profileId,
    feeds: [{ name: "Videos", url: "https://www.youtube.com/@BlenderOfficial/videos" }],
    sourceId: `UC${randomUUID()}`,
  });
}

/** `count` items seen at `at`, written in one statement as a check records them. */
async function seen(subscriptionId: string, at: Date, count: number, prefix: string) {
  await t.db
    .insertInto("subscription_items")
    .values(
      Array.from({ length: count }, (_, i) => ({
        subscription_id: subscriptionId,
        extractor: "youtube",
        video_id: `${prefix}${String(i).padStart(3, "0")}`,
        url: "u",
        outcome: "existing" as const,
        seen_at: at,
      })),
    )
    .execute();
}

async function page(s: SignedIn, id: string, cursor: string | null) {
  const q = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  const res = await h.app(s).request(`/api/subscriptions/${id}/items${q}`);
  expect(res.status).toBe(200);
  return SubscriptionItemsPage.parse(await res.json());
}

/** Every page in turn: the video ids in the order given, and how many pages it took. */
async function all(s: SignedIn, id: string): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const p = await page(s, id, cursor);
    ids.push(...p.items.map((i) => i.videoId));
    cursor = p.nextCursor;
    pages++;
  } while (cursor !== null && pages < 20);
  return { ids, pages };
}

describe("a subscription's activity, page by page", () => {
  it("pages through one check's items, which share a timestamp, losing and repeating none", async () => {
    const alice = await person();
    const id = await subscription(alice);
    // One check records well over a page at the same instant.
    const count = ITEMS_PAGE_SIZE * 2 + 7;
    await seen(id, new Date("2026-11-20T10:00:00.123456Z"), count, "same");
    const { ids, pages } = await all(alice, id);
    expect(pages).toBe(3);
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
    // Same instant: by video id, newest-first's tiebreak.
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("puts newer checks first across the page boundary", async () => {
    const alice = await person();
    const id = await subscription(alice);
    await seen(id, new Date("2026-11-20T10:00:00Z"), ITEMS_PAGE_SIZE, "old");
    await seen(id, new Date("2026-11-21T10:00:00Z"), ITEMS_PAGE_SIZE - 10, "new");
    const { ids } = await all(alice, id);
    expect(ids).toHaveLength(ITEMS_PAGE_SIZE * 2 - 10);
    expect(ids.slice(0, ITEMS_PAGE_SIZE - 10).every((v) => v.startsWith("new"))).toBe(true);
    expect(ids.slice(ITEMS_PAGE_SIZE - 10).every((v) => v.startsWith("old"))).toBe(true);
  });

  it("refuses a cursor it did not make (400)", async () => {
    const alice = await person();
    const id = await subscription(alice);
    const res = await h.app(alice).request(`/api/subscriptions/${id}/items?cursor=not-a-cursor`);
    expect(res.status).toBe(400);
  });

  it("is 404 to another person, who cannot check it now either", async () => {
    const [alice, bob] = [await person(), await person()];
    const id = await subscription(alice);
    await seen(id, new Date(), 1, "mine");
    expect((await h.app(bob).request(`/api/subscriptions/${id}/items`)).status).toBe(404);
    const check = await h.app(bob).request(`/api/subscriptions/${id}/check`, { method: "POST" });
    expect(check.status).toBe(404);
    expect((await page(alice, id, null)).items.map((i) => i.videoId)).toEqual(["mine000"]);
  });
});
