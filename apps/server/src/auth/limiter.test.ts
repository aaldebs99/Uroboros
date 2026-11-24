import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { createLimiter, sweepExpiredFailures } from "./limiter.ts";
import type { FailureKey } from "./limiter.ts";

let t: TestDb;

beforeEach(async () => {
  t = await TestDb.create();
});

afterEach(async () => {
  await t.close();
});

const user: FailureKey = { kind: "user", value: "alice" };
const ip: FailureKey = { kind: "ip", value: "203.0.113.1" };

async function failures(k: FailureKey): Promise<number | undefined> {
  const row = await t.db
    .selectFrom("signin_failures")
    .select("failures")
    .where("kind", "=", k.kind)
    .where("value", "=", k.value)
    .executeTakeFirst();
  return row?.failures;
}

describe("the sign-in limiter", () => {
  it("allows 5 failures per username in a window, then refuses", async () => {
    const limiter = createLimiter(t.db);
    for (let i = 0; i < 5; i++) expect(await limiter.attempt([user, ip])).toBe(false);
    expect(await limiter.attempt([user, ip])).toBe(true);
    expect(await failures(ip)).toBe(6);
  });

  it("starts a fresh window after 15 minutes", async () => {
    const limiter = createLimiter(t.db);
    for (let i = 0; i < 6; i++) await limiter.attempt([user]);
    await sql`UPDATE signin_failures SET expires_at = now() - interval '1 second'`.execute(t.db);
    expect(await limiter.attempt([user])).toBe(false);
    expect(await failures(user)).toBe(1);
  });

  it("clears the username and takes one attempt off the IP on a good sign-in", async () => {
    const limiter = createLimiter(t.db);
    await limiter.attempt([user, ip]);
    await limiter.attempt([user, ip]);
    await limiter.succeeded([user, ip]);
    expect(await failures(user)).toBeUndefined();
    expect(await failures(ip)).toBe(1);
  });

  it("never takes the IP count below zero", async () => {
    const limiter = createLimiter(t.db);
    await limiter.attempt([ip]);
    await limiter.succeeded([ip]);
    await limiter.succeeded([ip]);
    expect(await failures(ip)).toBe(0);
    await limiter.attempt([ip]);
    expect(await failures(ip)).toBe(1);
  });

  it("counts a key named twice once", async () => {
    const limiter = createLimiter(t.db);
    await limiter.attempt([user, user]);
    expect(await failures(user)).toBe(1);
  });

  it("sweeps expired windows", async () => {
    const limiter = createLimiter(t.db);
    await limiter.attempt([user, ip]);
    await sql`UPDATE signin_failures SET expires_at = now() - interval '1 second' WHERE kind = 'user'`.execute(
      t.db,
    );
    expect(await sweepExpiredFailures(t.db)).toBe(1);
    expect(await failures(ip)).toBe(1);
  });
});
