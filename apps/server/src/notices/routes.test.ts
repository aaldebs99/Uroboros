import type { OpenAPIHono } from "@hono/zod-openapi";
import { NoticeList } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { fileNotice, sweepOldNotices } from "./store.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);
const user = () => signedIn(t.db, { username: `nr${String(++n)}` });

/** Files a notice `minutesAgo` minutes old. */
async function filed(userId: string, title: string, minutesAgo = 0) {
  await fileNotice(t.db, userId, "downloads", { title, path: "/downloads" });
  await t.db
    .updateTable("notices")
    .set({ created_at: sql<Date>`now() - make_interval(mins => ${minutesAgo})` })
    .where("user_id", "=", userId)
    .where("title", "=", title)
    .execute();
}

async function list(s: SignedIn): Promise<NoticeList> {
  const res = await app(s).request("/api/notices");
  expect(res.status).toBe(200);
  return NoticeList.parse(await res.json());
}

describe("the notification list", () => {
  it("lists the caller's own, newest first, with the unread count", async () => {
    const [a, b] = [await user(), await user()];
    await filed(a.userId, "older", 10);
    await filed(a.userId, "newer", 1);
    await filed(b.userId, "theirs");
    const got = await list(a);
    expect(got.unread).toBe(2);
    expect(got.notices.map((x) => [x.title, x.read, x.kind, x.path])).toEqual([
      ["newer", false, "downloads", "/downloads"],
      ["older", false, "downloads", "/downloads"],
    ]);
  });

  it("marks read only up to the newest one the person saw", async () => {
    const a = await user();
    await filed(a.userId, "seen", 5);
    const seen = (await list(a)).notices[0];
    await filed(a.userId, "arrived since");
    const res = await app(a).request("/api/notices/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upTo: seen?.createdAt }),
    });
    expect(res.status).toBe(204);
    const got = await list(a);
    expect(got.unread).toBe(1);
    expect(got.notices.map((x) => [x.title, x.read])).toEqual([
      ["arrived since", false],
      ["seen", true],
    ]);
  });

  it("clears only the caller's", async () => {
    const [a, b] = [await user(), await user()];
    await filed(a.userId, "mine");
    await filed(b.userId, "theirs");
    expect((await app(a).request("/api/notices", { method: "DELETE" })).status).toBe(204);
    expect(await listedNotices(t.db, a.userId)).toEqual([]);
    expect(await listedNotices(t.db, b.userId)).toHaveLength(1);
  });

  it("needs a session", async () => {
    const res = await createApp({ db: t.db, version: "t", logger }, { webDist: null }).request(
      "/api/notices",
    );
    expect(res.status).toBe(401);
  });

  it("drops notices older than a month", async () => {
    const a = await user();
    await filed(a.userId, "old", 31 * 24 * 60);
    await filed(a.userId, "fresh", 29 * 24 * 60);
    expect(await sweepOldNotices(t.db)).toBe(1);
    expect((await listedNotices(t.db, a.userId)).map((x) => x.title)).toEqual(["fresh"]);
  });
});
