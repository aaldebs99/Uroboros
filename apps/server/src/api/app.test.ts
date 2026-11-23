import { createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody } from "@uroboros/contract";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { createDb } from "../db/kysely.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import { createApp } from "./app.ts";
import type { Deps } from "./app.ts";

const logger = pino({ level: "silent" });
const CLOSED = "127.0.0.1:1";

let testDb: TestDb;
let valkey: Redis;
let session: SignedIn;
const extra: { close(): unknown }[] = [];

beforeAll(async () => {
  testDb = await TestDb.create();
  session = await signedIn(testDb.db, { username: "tester" });
  valkey = createValkey(TestValkey.url(), "api", logger);
  await waitReady(valkey, 5000);
});

afterAll(async () => {
  valkey.disconnect();
  await testDb.close();
  for (const e of extra) await e.close();
});

const deps = (over: Partial<Deps> = {}): Deps => ({
  db: testDb.db,
  valkey,
  version: "1.2.3",
  logger,
  ...over,
});
const app = (over: Partial<Deps> = {}, webDist: string | null = null): OpenAPIHono =>
  createApp(deps(over), { webDist });

describe("readiness", () => {
  it("is ok when both dependencies answer", async () => {
    const res = await app().request("/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", failing: [] });
  });

  it("is degraded with database failing when postgres is unreachable", async () => {
    const db = createDb(`postgres://u:p@${CLOSED}/x`, logger);
    extra.push({ close: () => db.destroy() });
    const res = await app({ db }).request("/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", failing: ["database"] });
  });

  it("is degraded with valkey failing, quickly, when valkey is unreachable", async () => {
    const down = createValkey(`redis://${CLOSED}`, "api", logger);
    extra.push({
      close: () => {
        down.disconnect();
      },
    });
    const start = Date.now();
    const res = await app({ valkey: down }).request("/api/ready");
    expect(Date.now() - start).toBeLessThan(3000);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", failing: ["valkey"] });
  });
});

describe("readiness timeout", () => {
  it("reports a hanging valkey as failing within 3s", async () => {
    const hung = { ping: () => new Promise<never>(() => undefined) } as unknown as Redis;
    const start = Date.now();
    const res = await app({ valkey: hung }).request("/api/ready");
    expect(Date.now() - start).toBeLessThan(3000);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "degraded", failing: ["valkey"] });
  });

  it("reports a hanging database as failing within 3s", async () => {
    // A pool whose connect never completes: the TCP listener accepts but never speaks.
    const sockets: Socket[] = [];
    const server = createServer((s) => sockets.push(s));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const db = createDb(`postgres://u:p@127.0.0.1:${String(port)}/x`, logger);
    extra.push({
      close: async () => {
        for (const s of sockets) s.destroy();
        server.close();
        await db.destroy();
      },
    });
    const start = Date.now();
    const res = await app({ db }).request("/api/ready");
    expect(Date.now() - start).toBeLessThan(3000);
    expect(await res.json()).toEqual({ status: "degraded", failing: ["database"] });
  });
});

describe("pool resilience", () => {
  it("survives idle backends being killed and recovers", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on("uncaughtException", onUncaught);
    try {
      const own = await TestDb.create();
      // The pool's 'error' listener logs each idle client it discards; waiting for that line is
      // the signal that the kill has been seen, however slow the runner.
      const logged: string[] = [];
      const db = createDb(
        own.url,
        pino({ name: "db" }, { write: (line: string) => logged.push(line) }),
      );
      try {
        const a = app({ db });
        expect(await (await a.request("/api/ready")).json()).toEqual({
          status: "ok",
          failing: [],
        });
        const dbName = new URL(own.url).pathname.slice(1);
        await withAdmin(inject("postgresUrl"), (admin) =>
          admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [dbName],
          ),
        );
        await vi.waitFor(
          () => {
            expect(logged.some((line) => line.includes("idle postgres client error"))).toBe(true);
          },
          { timeout: 10_000 },
        );
        expect(uncaught).toEqual([]);
        expect(await (await a.request("/api/ready")).json()).toEqual({
          status: "ok",
          failing: [],
        });
      } finally {
        await db.destroy();
        await own.close();
      }
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});

describe("info", () => {
  it("returns name and version, and no public address when none is set", async () => {
    const res = await app().request("/api/info");
    expect(await res.json()).toEqual({ name: "uroboros", version: "1.2.3", publicBaseUrl: null });
  });
});

describe("errors", () => {
  it("renders unknown api paths as a typed 401 before sign-in, never HTML", async () => {
    const res = await app().request("/api/nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(ApiErrorBody.parse(await res.json()).code).toBe("unauthorized");
  });

  it("renders unknown api paths as a typed 404 once signed in", async () => {
    const res = await asUser(app(), session).request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(ApiErrorBody.parse(await res.json()).code).toBe("not_found");
  });

  it("hides the message of unexpected errors", async () => {
    const a = app();
    a.get("/api/boom", () => {
      throw new Error("secret");
    });
    const res = await asUser(a, session).request("/api/boom");
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(ApiErrorBody.parse(JSON.parse(text)).code).toBe("internal");
    expect(text).not.toContain("secret");
  });
});

describe("openapi", () => {
  it("documents the shared schemas", async () => {
    const res = await app().request("/api/openapi.json");
    const doc = (await res.json()) as { components: { schemas: Record<string, unknown> } };
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["Liveness", "Readiness", "Info", "ApiErrorBody"]),
    );
  });

  it("serves swagger ui", async () => {
    const res = await app().request("/api/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves swagger ui from its own origin only, with every asset present", async () => {
    const a = app();
    const html = await (await a.request("/api/docs")).text();
    const refs = [...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(refs.length).toBeGreaterThanOrEqual(3);
    for (const ref of refs) {
      expect(ref, ref).toMatch(/^\/(?!\/)/);
      const asset = await a.request(ref);
      expect(asset.status, ref).toBe(200);
      const type = asset.headers.get("content-type") ?? "";
      expect(type, ref).toMatch(/^(text\/css|text\/javascript)/);
      if (type.startsWith("text/javascript") && !ref.endsWith("-bundle.js")) {
        expect(await asset.text(), ref).not.toMatch(/https?:\/\//);
      }
    }
  });
});

describe("spa", () => {
  let dist: string;
  /** A build with nothing but index.html: every static file is missing. */
  let bare: string;
  beforeAll(async () => {
    bare = await mkdtemp(join(tmpdir(), "uroboros-web-"));
    await writeFile(join(bare, "index.html"), "<!doctype html><title>x</title>");
    dist = await mkdtemp(join(tmpdir(), "uroboros-web-"));
    await mkdir(join(dist, "assets"));
    await writeFile(join(dist, "index.html"), "<!doctype html><title>x</title>");
    await writeFile(join(dist, "assets", "a.js"), "console.log(1)");
    await writeFile(join(dist, "sw.js"), "self.x = 1");
    await writeFile(join(dist, "manifest.webmanifest"), '{"name":"Uroboros"}');
  });
  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
  });

  it("falls back to index.html for client routes", async () => {
    const res = await app({}, dist).request("/library/abc");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves static assets", async () => {
    const res = await app({}, dist).request("/assets/a.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("never lets index.html, sw.js or the manifest be cached", async () => {
    for (const path of ["/", "/index.html", "/library/abc", "/sw.js", "/manifest.webmanifest"]) {
      const res = await app({}, dist).request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("caches hashed assets forever", async () => {
    const res = await app({}, dist).request("/assets/a.js");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves the manifest as a web app manifest", async () => {
    const res = await app({}, dist).request("/manifest.webmanifest");
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
  });

  it.each(["/missing.js", "/assets/gone.js", "/assets/deep/gone.css", "/manifest.webmanifest"])(
    "answers a missing static file (%s) with a 404, not the app",
    async (path) => {
      const res = await app({}, bare).request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toContain("text/html");
    },
  );

  it("answers a missing sw.js with a 404", async () => {
    expect((await app({}, bare).request("/sw.js")).status).toBe(404);
    expect((await app({}, bare).request("/settings")).status).toBe(200);
  });

  it.each(["/library/@john.doe", "/watch/foo.bar", "/deep/path/icon.png", "/a/b.c/d"])(
    "serves the app for a client route with a dot in it (%s)",
    async (path) => {
      const res = await app({}, bare).request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    },
  );

  it("still serves an existing file below the root that is not under assets", async () => {
    await mkdir(join(dist, "fonts"), { recursive: true });
    await writeFile(join(dist, "fonts", "x.woff2"), "w");
    const res = await app({}, dist).request("/fonts/x.woff2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff2");
  });

  it("keeps the json 404 under /api", async () => {
    const res = await asUser(app({}, dist), session).request("/api/nope");
    expect(res.status).toBe(404);
    expect(ApiErrorBody.parse(await res.json()).code).toBe("not_found");
  });

  it("does not escape the web root", async () => {
    const res = await app({}, dist).request("/..%2f..%2fetc/passwd");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("is not served when webDist is null", async () => {
    expect((await app().request("/library/abc")).status).toBe(404);
  });
});
