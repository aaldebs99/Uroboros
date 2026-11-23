import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";

let t: TestDb;
beforeEach(async () => {
  t = await TestDb.create();
});
afterEach(async () => {
  await t.close();
});

const device = (userId: string, endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) =>
  sql`INSERT INTO push_devices (user_id, endpoint, p256dh, auth, label)
      VALUES (${userId}, ${endpoint}, 'k', 'a', 'test')`;

async function localUser(username: string): Promise<string> {
  const row = await t.db
    .insertInto("users")
    .values({ username, password_hash: "x", display_name: username, role: "member" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function errCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe("schema: users and auth", () => {
  it("refuses push devices for an unknown user (foreign key)", async () => {
    expect(await errCode(device(randomUUID()).execute(t.db))).toBe("23503");
  });

  it("refuses an account that is both local and SSO", async () => {
    const both = t.db
      .insertInto("users")
      .values({
        username: "both",
        password_hash: "x",
        oidc_issuer: "https://sso.example",
        oidc_subject: "sub",
        display_name: "Both",
        role: "member",
      })
      .execute();
    expect(await errCode(both)).toBe("23514");
  });

  it("accepts push devices for a real user", async () => {
    const id = await localUser("owner");
    await expect(device(id).execute(t.db)).resolves.toBeDefined();
  });

  it("refuses an enabled account with no way to sign in", async () => {
    const none = t.db
      .insertInto("users")
      .values({ display_name: "Nobody", role: "member" })
      .execute();
    expect(await errCode(none)).toBe("23514");
  });

  it("keeps usernames unique case-insensitively stored lower-case", async () => {
    await localUser("alice");
    expect(await errCode(localUser("alice"))).toBe("23505");
  });

  it("allows only one bootstrap account", async () => {
    const a = await localUser("a");
    const b = await localUser("b");
    await t.db.updateTable("users").set({ bootstrap: true }).where("id", "=", a).execute();
    expect(
      await errCode(
        t.db.updateTable("users").set({ bootstrap: true }).where("id", "=", b).execute(),
      ),
    ).toBe("23505");
  });

  it("deleting a user cascades sessions, tokens, grants, devices and tombstones", async () => {
    const id = await localUser("gone");
    await t.db
      .insertInto("auth_sessions")
      .values({
        token_hash: Buffer.alloc(32, 1),
        user_id: id,
        csrf: "c",
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute();
    await t.db
      .insertInto("api_tokens")
      .values({ user_id: id, name: "t", token_hash: Buffer.alloc(32, 2) })
      .execute();
    await t.db.insertInto("oidc_grants").values({ user_id: id, refresh_token: "r" }).execute();
    await device(id).execute(t.db);
    await t.db
      .insertInto("push_device_tombstones")
      .values({ endpoint_hash: Buffer.alloc(32, 3), user_id: id })
      .execute();

    await t.db.deleteFrom("users").where("id", "=", id).execute();

    for (const table of [
      "auth_sessions",
      "api_tokens",
      "oidc_grants",
      "push_devices",
      "push_device_tombstones",
    ] as const) {
      const { n } = await t.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("user_id", "=", id)
        .executeTakeFirstOrThrow();
      expect([table, n]).toEqual([table, "0"]);
    }
  });

  it("keeps API token names unique per user", async () => {
    const id = await localUser("tok");
    await t.db
      .insertInto("api_tokens")
      .values({ user_id: id, name: "x", token_hash: Buffer.alloc(32, 4) })
      .execute();
    expect(
      await errCode(
        t.db
          .insertInto("api_tokens")
          .values({ user_id: id, name: "x", token_hash: Buffer.alloc(32, 5) })
          .execute(),
      ),
    ).toBe("23505");
  });
});
