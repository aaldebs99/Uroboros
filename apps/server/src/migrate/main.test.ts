import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { gate, onPort, type Gate } from "../../test/forwarder.ts";
import { createEmptyDatabase } from "../../test/testDb.ts";
import { main } from "./main.ts";

/** `mise run migrate`: 0 ok, 1 a migration or connection failure, 2 configuration. */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

let empty: Awaited<ReturnType<typeof createEmptyDatabase>>;
const gates: Gate[] = [];

beforeEach(async () => {
  empty = await createEmptyDatabase(inject("postgresUrl"));
  // Its report goes to the console; these tests read the exit code.
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(gates.splice(0).map((g) => g.close()));
  await empty.drop();
});

const run = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return main();
};

describe("the migrate command", () => {
  it("applies the migrations and exits 0, and 0 again with nothing pending", async () => {
    const env = { DATABASE_URL: empty.url, UROBOROS_MIGRATIONS_DIR: fixture("migrations-ok") };
    expect(await run(env)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      "applied: 20261121143000_create_widgets.sql, 20261121143512_add_widget_color.sql",
    );
    expect(await run(env)).toBe(0);
    expect(console.log).toHaveBeenLastCalledWith("no pending migrations");
  });

  it("exits 1 on a migration that fails", async () => {
    expect(
      await run({
        DATABASE_URL: empty.url,
        UROBOROS_MIGRATIONS_DIR: fixture("migrations-bad-sql"),
      }),
    ).toBe(1);
  });

  it("exits 1 at once on a server it cannot reach, never waiting for it", async () => {
    const g = await gate(empty.url);
    gates.push(g);
    const started = Date.now();
    expect(
      await run({
        DATABASE_URL: onPort(empty.url, g.port),
        UROBOROS_MIGRATIONS_DIR: fixture("migrations-ok"),
      }),
    ).toBe(1);
    expect(g.refused).toBe(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("exits 2 without a DATABASE_URL", async () => {
    expect(await run({ DATABASE_URL: "" })).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"));
  });
});
