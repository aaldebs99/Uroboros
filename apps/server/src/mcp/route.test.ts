import type { OpenAPIHono } from "@hono/zod-openapi";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mcpPost, mcpToken, setMcp, toolNames } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let app: OpenAPIHono;
let secret: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  app = createApp({ db: testDb.db, version: "9.9.9", logger }, { webDist: null });
  secret = await mcpToken(testDb.db, await insertUser(testDb.db, { username: "mcproute" }));
});
afterAll(async () => {
  await testDb.close();
});

const initialize = (a: OpenAPIHono, s: string) =>
  mcpPost(a, s, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1" },
  });

describe("the MCP endpoint", () => {
  it("answers 404 while the MCP server is off", async () => {
    await setMcp(testDb.db, false);
    const res = await initialize(app, secret);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found", message: "the MCP server is off" });
  });

  it("introduces itself as Uroboros and offers its tools once it is on", async () => {
    await setMcp(testDb.db, true);
    const res = await initialize(app, secret);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string; version: string } };
    };
    expect(body.result.serverInfo).toMatchObject({ name: "uroboros", version: "9.9.9" });
    expect(await toolNames(app, secret)).toEqual(
      expect.arrayContaining([
        "get_entry",
        "get_playlist",
        "list_channels",
        "list_playlists",
        "read_transcript",
        "search_library",
      ]),
    );
  });

  it("serves a client of the 2026-07-28 revision too, in plain JSON", async () => {
    await setMcp(testDb.db, true);
    const _meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "vitest", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "list_channels",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { _meta, name: "list_channels", arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { structuredContent: unknown } };
    expect(body.result.structuredContent).toEqual({ channels: [] });
  });

  it("keeps no sessions, so a GET for a stream is refused", async () => {
    await setMcp(testDb.db, true);
    const res = await app.request("/api/mcp", {
      headers: { authorization: `Bearer ${secret}`, accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });

  it("answers 503 while the replica is starting", async () => {
    const starting = createApp(
      { db: testDb.db, version: "t", logger, attached: () => false },
      { webDist: null },
    );
    expect((await initialize(starting, secret)).status).toBe(503);
  });

  it("refuses a body over the API's limit", async () => {
    await setMcp(testDb.db, true);
    const res = await mcpPost(app, secret, "tools/call", {
      name: "search_library",
      arguments: { q: "x".repeat(70 * 1024) },
    });
    expect(res.status).toBe(413);
  });

  it("answers OAuth discovery with a JSON 404, not the web app", async () => {
    const dist = await mkdtemp(join(tmpdir(), "uroboros-web-"));
    try {
      await writeFile(join(dist, "index.html"), "<!doctype html><title>x</title>");
      const withSpa = createApp({ db: testDb.db, version: "t", logger }, { webDist: dist });
      expect((await withSpa.request("/library/x")).status).toBe(200);
      for (const path of [
        "/.well-known/oauth-protected-resource/api/mcp",
        "/.well-known/oauth-authorization-server",
      ]) {
        const res = await withSpa.request(path);
        expect([path, res.status]).toEqual([path, 404]);
        expect(res.headers.get("content-type")).toContain("application/json");
      }
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
