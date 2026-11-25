import { NotificationPrefs } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { wantsNotice } from "./prefs.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const app = (u: SignedIn) =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), u);
/** A person of each test's own, so no test sees another's choices. */
const person = () => signedIn(t.db, { username: `prefs${String(++n)}` });

describe("which notifications a person wants", () => {
  it("defaults to all of them", async () => {
    const alice = await person();
    const res = await app(alice).request("/api/me/notifications");
    expect(res.status).toBe(200);
    expect(NotificationPrefs.parse(await res.json())).toEqual({
      downloads: true,
      shares: true,
      groups: true,
    });
    expect(await wantsNotice(t.db, alice.userId, "downloads")).toBe(true);
  });

  it("saves a choice", async () => {
    const alice = await person();
    const res = await app(alice).request("/api/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ downloads: false, shares: true, groups: false }),
    });
    expect(res.status).toBe(200);
    expect(NotificationPrefs.parse(await res.json())).toEqual({
      downloads: false,
      shares: true,
      groups: false,
    });
    expect(await wantsNotice(t.db, alice.userId, "downloads")).toBe(false);
    expect(await wantsNotice(t.db, alice.userId, "shares")).toBe(true);
    expect(await wantsNotice(t.db, alice.userId, "groups")).toBe(false);
  });
});
