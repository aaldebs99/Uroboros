import { ApiErrorBody } from "@uroboros/contract";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HTTPException } from "hono/http-exception";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "./app.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let dist: string;
let session: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  session = await signedIn(testDb.db, { username: "sec" });
  dist = await mkdtemp(join(tmpdir(), "uroboros-web-"));
  await writeFile(join(dist, "index.html"), "<!doctype html><title>x</title>");
});

afterAll(async () => {
  await testDb.close();
  await rm(dist, { recursive: true, force: true });
});

const app = (bodyLimitBytes?: number) =>
  asUser(
    createApp(
      { db: testDb.db, version: "t", logger },
      { webDist: dist, ...(bodyLimitBytes === undefined ? {} : { bodyLimitBytes }) },
    ),
    session,
  );

/** The directives of a Content-Security-Policy header, by name. */
function csp(res: Response): Map<string, string> {
  const header = res.headers.get("content-security-policy") ?? "";
  return new Map(
    header
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "")
      .map((d) => {
        const [name = "", ...values] = d.split(/\s+/);
        return [name, values.join(" ")] as const;
      }),
  );
}

describe("security headers", () => {
  it.each(["/", "/library/abc", "/api/health", "/api/nope"])(
    "sets the baseline headers on %s",
    async (path) => {
      const res = await app().request(path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    },
  );

  it("gives the SPA a self-only CSP with no inline script", async () => {
    const policy = csp(await app().request("/library/abc"));
    expect(policy.get("default-src")).toBe("'self'");
    expect(policy.get("script-src")).toBe("'self'");
    expect(policy.get("connect-src")).toBe("'self'");
    expect(policy.get("worker-src")).toBe("'self'");
    expect(policy.get("manifest-src")).toBe("'self'");
    expect(policy.get("img-src")).toBe("'self' data:");
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("base-uri")).toBe("'self'");
    expect(policy.get("form-action")).toBe("'self'");
  });

  it("allows blob: media, which Video.js's HLS engine plays from", async () => {
    expect(csp(await app().request("/library/abc")).get("media-src")).toBe("'self' blob:");
  });

  it("gives /api/docs a CSP of its own, also self-only for scripts", async () => {
    const policy = csp(await app().request("/api/docs"));
    expect(policy.get("script-src")).toBe("'self'");
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("default-src")).toBe("'self'");
  });
});

describe("body limit", () => {
  const echo = (limit?: number) => {
    const a = app(limit);
    a.post("/api/test/echo", async (c) => c.text(String((await c.req.text()).length)));
    return a;
  };
  const post = (a: ReturnType<typeof echo>, bytes: number) =>
    a.request("/api/test/echo", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(bytes),
    });

  it("accepts a body up to 64 KiB by default", async () => {
    const res = await post(echo(), 64 * 1024);
    expect(res.status).toBe(200);
  });

  it("answers a larger body with a typed 413", async () => {
    const res = await post(echo(), 64 * 1024 + 1);
    expect(res.status).toBe(413);
    expect(ApiErrorBody.parse(await res.json()).code).toBe("payload_too_large");
  });

  it("honours a configured limit", async () => {
    expect((await post(echo(10), 11)).status).toBe(413);
    expect((await post(echo(10), 10)).status).toBe(200);
  });
});

describe("HTTPException mapping", () => {
  it.each([
    [400, 400, "bad_request"],
    [401, 401, "unauthorized"],
    [403, 403, "forbidden"],
    [404, 404, "not_found"],
    [405, 400, "bad_request"],
    [409, 409, "conflict"],
    [413, 413, "payload_too_large"],
    [422, 422, "unprocessable"],
    [429, 429, "too_many_requests"],
    [500, 500, "internal"],
    [503, 503, "unavailable"],
  ] as const)("renders HTTPException %i as %i %s", async (thrown, status, code) => {
    const a = app();
    a.get("/api/test/throw", () => {
      throw new HTTPException(thrown, { message: "secret detail" });
    });
    const res = await a.request("/api/test/throw");
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(ApiErrorBody.parse(JSON.parse(text)).code).toBe(code);
    expect(text).not.toContain("secret detail");
  });
});
