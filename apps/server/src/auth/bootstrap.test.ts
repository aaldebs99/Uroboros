import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { ensureBootstrapAdmin } from "./bootstrap.ts";
import { verifyPassword } from "./passwords.ts";

const log = pino({ level: "silent" });
const PASSWORD = "correct horse battery";

let t: TestDb;
beforeEach(async () => {
  t = await TestDb.create();
});
afterEach(async () => {
  await t.close();
});

const bootstrapRows = () =>
  t.db
    .selectFrom("users")
    .select(["id", "username", "role", "password_hash", "bootstrap"])
    .where("bootstrap", "=", true)
    .execute();

describe("ensureBootstrapAdmin", () => {
  it("creates the bootstrap admin on an empty database", async () => {
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    const [row, ...rest] = await bootstrapRows();
    expect(rest).toEqual([]);
    expect(row?.username).toBe("admin");
    expect(row?.role).toBe("admin");
    expect(await verifyPassword(row?.password_hash ?? "", PASSWORD)).toBe(true);
  });

  it("re-seeds the password and admin role, keeping the hash when it still verifies", async () => {
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    const [first] = await bootstrapRows();
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    expect((await bootstrapRows())[0]?.password_hash).toBe(first?.password_hash);

    await t.db.updateTable("users").set({ role: "member" }).where("bootstrap", "=", true).execute();
    await ensureBootstrapAdmin(t.db, { username: "admin", password: "a brand new password" }, log);
    const [after] = await bootstrapRows();
    expect(after?.role).toBe("admin");
    expect(await verifyPassword(after?.password_hash ?? "", "a brand new password")).toBe(true);
  });

  it("renames the bootstrap account when the configured username changes", async () => {
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    await ensureBootstrapAdmin(t.db, { username: "root", password: PASSWORD }, log);
    const rows = await bootstrapRows();
    expect(rows.map((r) => r.username)).toEqual(["root"]);
  });

  it("adopts an existing local account of the same name", async () => {
    const id = await insertUser(t.db, { username: "admin" });
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    const [row, ...rest] = await bootstrapRows();
    expect(rest).toEqual([]);
    expect(row?.id).toBe(id);
    expect(row?.role).toBe("admin");
  });

  it("refuses to rename onto another account's username", async () => {
    await ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log);
    await insertUser(t.db, { username: "taken" });
    await expect(
      ensureBootstrapAdmin(t.db, { username: "taken", password: PASSWORD }, log),
    ).rejects.toThrow(/taken/);
  });

  it("tolerates two replicas starting at once", async () => {
    await Promise.all([
      ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log),
      ensureBootstrapAdmin(t.db, { username: "admin", password: PASSWORD }, log),
    ]);
    expect(await bootstrapRows()).toHaveLength(1);
  });
});
