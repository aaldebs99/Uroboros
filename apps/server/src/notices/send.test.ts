import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { nextMessage, testBus } from "../../test/bus.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { sendNotice } from "./send.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let bus: PgBus;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  bus = testBus(t);
  await bus.ready;
});
afterAll(async () => {
  await bus.close();
  await h.close();
  await t.close();
});

const deps = () => ({ db: t.db, notify: h.queues.notify });
const user = async () => (await signedIn(t.db, { username: `sn${String(++n)}` })).userId;
const message = { title: "Ready: Big Buck Bunny", path: "/library/x", tag: "request-1" };

async function pushed(userId: string) {
  return (await queuedData<NotifyJob>(t.db, "notify")).filter((j) => j.userId === userId);
}

describe("sendNotice", () => {
  it("files the notice, nudges open tabs, and pushes it", async () => {
    const userId = await user();
    const nudge = nextMessage(bus, "uroboros_downloads");
    await sendNotice(deps(), { userId, kind: "downloads", message, urgency: "normal" });
    expect(JSON.parse(await nudge)).toEqual({ kind: "notice", userId });
    expect(await listedNotices(t.db, userId)).toMatchObject([
      { kind: "downloads", title: message.title, body: null, path: "/library/x", read_at: null },
    ]);
    expect(await pushed(userId)).toMatchObject([{ message, urgency: "normal" }]);
  });

  it("still files a kind the person muted, but pushes nothing", async () => {
    const userId = await user();
    await t.db
      .insertInto("notification_prefs")
      .values({ user_id: userId, downloads: false })
      .execute();
    await sendNotice(deps(), { userId, kind: "downloads", message, urgency: "normal" });
    expect(await listedNotices(t.db, userId)).toHaveLength(1);
    expect(await pushed(userId)).toEqual([]);
  });

  it("files without pushing when told not to (a subscription's own switch)", async () => {
    const userId = await user();
    await sendNotice(deps(), {
      userId,
      kind: "subscriptions",
      message: { title: "New from Blender", path: "/subscriptions/s", tag: "subscription-s" },
      urgency: "normal",
      push: false,
    });
    expect(await listedNotices(t.db, userId)).toMatchObject([{ kind: "subscriptions" }]);
    expect(await pushed(userId)).toEqual([]);
  });

  it("replaces a notice with the same tag, unread again; untagged ones stack", async () => {
    const userId = await user();
    await sendNotice(deps(), { userId, kind: "downloads", message, urgency: "normal" });
    await t.db
      .updateTable("notices")
      .set({ read_at: new Date() })
      .where("user_id", "=", userId)
      .execute();
    await sendNotice(deps(), {
      userId,
      kind: "downloads",
      message: { ...message, title: "2 videos from Shorts are ready", body: "a\nb" },
      urgency: "normal",
    });
    const plain = { title: "Hello", path: "/" };
    await sendNotice(deps(), { userId, kind: "shares", message: plain, urgency: "normal" });
    await sendNotice(deps(), { userId, kind: "shares", message: plain, urgency: "normal" });
    const listed = await listedNotices(t.db, userId);
    expect(listed.map((l) => l.title)).toEqual([
      "Hello",
      "Hello",
      "2 videos from Shorts are ready",
    ]);
    expect(listed[2]).toMatchObject({ body: "a\nb", read_at: null });
  });
});
