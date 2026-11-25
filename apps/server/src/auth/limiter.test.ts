import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { createLimiter, failureKeys, limiterAddress, sweepExpiredFailures } from "./limiter.ts";
import type { FailureKey } from "./limiter.ts";

let t: TestDb;

beforeEach(async () => {
  t = await TestDb.create();
});

afterEach(async () => {
  await t.close();
});

const user: FailureKey = { kind: "user_ip", value: "alice|203.0.113.1" };
const account: FailureKey = { kind: "user", value: "alice" };
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
  it("allows 5 failures per username from one address in a window, then refuses", async () => {
    const limiter = createLimiter(t.db);
    for (let i = 0; i < 5; i++) expect(await limiter.attempt([user, account, ip])).toBe(false);
    expect(await limiter.attempt([user, account, ip])).toBe(true);
    expect(await failures(ip)).toBe(6);
    // the refused sixth attempt no longer counts against the username itself
    expect(await failures(account)).toBe(5);
  });

  it("allows 100 failures per username across addresses, then refuses", async () => {
    const limiter = createLimiter(t.db);
    const from = (n: number): FailureKey[] => [
      { kind: "user_ip", value: `alice|198.51.100.${String(n % 25)}` },
      account,
    ];
    for (let i = 0; i < 100; i++) expect(await limiter.attempt(from(i))).toBe(false);
    expect(await limiter.attempt(from(100))).toBe(true);
  });

  it("stops counting an address against the username once the address is refused", async () => {
    const limiter = createLimiter(t.db);
    for (let i = 0; i < 101; i++) await limiter.attempt(failureKeys("alice", "203.0.113.50"));
    expect(await failures(account)).toBe(5);
    expect(await limiter.attempt(failureKeys("alice", "198.51.100.7"))).toBe(false);
  });

  it("counts an IPv6 client by its /64, and an IPv4-mapped one as IPv4", () => {
    expect(limiterAddress("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(limiterAddress("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64");
    expect(limiterAddress("2001:db8::7")).toBe("2001:db8:0:0::/64");
    expect(limiterAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(limiterAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(limiterAddress("unknown")).toBe("unknown");
  });

  it("starts a fresh window after 15 minutes", async () => {
    const limiter = createLimiter(t.db);
    for (let i = 0; i < 6; i++) await limiter.attempt([user]);
    await sql`UPDATE signin_failures SET expires_at = now() - interval '1 second'`.execute(t.db);
    expect(await limiter.attempt([user])).toBe(false);
    expect(await failures(user)).toBe(1);
  });

  it("clears the username's counts and takes one attempt off the IP on a good sign-in", async () => {
    const limiter = createLimiter(t.db);
    await limiter.attempt([user, account, ip]);
    await limiter.attempt([user, account, ip]);
    await limiter.succeeded([user, account, ip]);
    expect(await failures(user)).toBeUndefined();
    expect(await failures(account)).toBeUndefined();
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
    await sql`UPDATE signin_failures SET expires_at = now() - interval '1 second' WHERE kind = 'user_ip'`.execute(
      t.db,
    );
    expect(await sweepExpiredFailures(t.db)).toBe(1);
    expect(await failures(ip)).toBe(1);
  });
});
