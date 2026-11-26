import type { OpenAPIHono } from "@hono/zod-openapi";
import { Download, DownloadRequest, FormatProfile, QueueSelectionResult } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHarness } from "../../test/downloads.ts";
import { callTool, mcpPost, mcpToken, toolNames } from "../../test/mcp.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createApp } from "../api/app.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let app: OpenAPIHono;
let owner: string;
let secret: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  app = createApp(
    { db: testDb.db, version: "t", logger, downloads: h.ctx },
    { webDist: null, mcpEnabled: true },
  );
  owner = await insertUser(testDb.db, { username: "mcpdl" });
  secret = await mcpToken(testDb.db, owner);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const ok = async (s: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await callTool(app, s, name, args);
  // the tool's error text, when it fails, says why
  expect([name, r.isError === true ? r.content[0]?.text : "ok"]).toEqual([name, "ok"]);
  return r.structuredContent;
};

const result = (id: string) => ({
  id,
  extractor: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Result ${id}`,
  duration: 60,
  uploader: "Blender Studio",
  thumbnailUrl: null,
});

/** What the probe worker does when a search's results page is listed. */
const listResults = (requestId: string, ids: string[]) =>
  testDb.db
    .updateTable("download_requests")
    .set({
      state: "choosing",
      kind: "playlist",
      title: "blender",
      entries: JSON.stringify([
        { name: "YouTube", ticked: false, truncated: false, entries: ids.map(result) },
      ]),
    })
    .where("id", "=", requestId)
    .execute();

async function searchAndPick(s: string, ids: string[]): Promise<string> {
  const req = DownloadRequest.parse(await ok(s, "search_youtube", { query: "blender" }));
  await listResults(req.id, ids);
  const picked = QueueSelectionResult.parse(
    await ok(s, "queue_selection", { requestId: req.id, entryIds: ids }),
  );
  expect(picked).toEqual({ queued: ids.length, skipped: 0 });
  const listed = Download.array().parse((await ok(s, "list_downloads"))?.downloads);
  const id = listed.find((d) => d.title === `Result ${ids[0] ?? ""}`)?.id;
  if (id === undefined) throw new Error("no download");
  return id;
}

describe("the MCP download tools", () => {
  it("search YouTube and wait for the results to be listed", async () => {
    const req = DownloadRequest.parse(await ok(secret, "search_youtube", { query: "blender" }));
    expect(req).toMatchObject({ state: "probing", groups: [] });
    expect(await h.queues.probe.get(`probe|${req.id}`)).toBeDefined();
    setTimeout(() => void listResults(req.id, ["a1"]), 300);
    const started = Date.now();
    const done = DownloadRequest.parse(
      await ok(secret, "get_download_request", { requestId: req.id, waitSeconds: 10 }),
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(done.state).toBe("choosing");
    expect(done.groups[0]?.entries.map((e) => e.id)).toEqual(["a1"]);
  });

  it("save picked results, then list them as downloads", async () => {
    const id = await searchAndPick(secret, ["b1", "b2"]);
    const [d] = Download.array().parse(
      (await ok(secret, "list_downloads", { ids: [id] }))?.downloads,
    );
    expect(d).toMatchObject({ title: "Result b1", state: "queued" });
  });

  it("download a pasted link with the default profile or a chosen one", async () => {
    const profiles = FormatProfile.array().parse((await ok(secret, "list_profiles"))?.profiles);
    expect(profiles.some((p) => p.isDefault)).toBe(true);
    const chosen = profiles.at(-1);
    const req = DownloadRequest.parse(
      await ok(secret, "download_link", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        profileId: chosen?.id,
      }),
    );
    expect(req).toMatchObject({ state: "probing", profileId: chosen?.id });
  });

  it("take a link without a scheme as an https one", async () => {
    const req = DownloadRequest.parse(
      await ok(secret, "download_link", { url: "youtube.com/watch?v=dQw4w9WgXcQ" }),
    );
    expect(req).toMatchObject({ state: "probing", url: "https://youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("refuse an empty list of ids as a mistake in the call, not a failure of the server", async () => {
    const r = await callTool(app, secret, "list_downloads", { ids: [] });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^Input validation error: .*ids/);
  });

  it("cancel a download and retry it", async () => {
    const id = await searchAndPick(secret, ["c1"]);
    const cancelled = Download.parse(await ok(secret, "cancel_download", { downloadId: id }));
    expect(cancelled.state).toBe("cancelled");
    const retried = Download.parse(await ok(secret, "retry_download", { downloadId: id }));
    expect(retried.state).toBe("queued");
  });

  it("offer a read-only token none of them that change anything", async () => {
    const reader = await mcpToken(testDb.db, owner, { readOnly: true });
    const names = await toolNames(app, reader);
    expect(names).toEqual(
      expect.arrayContaining(["get_download_request", "list_downloads", "list_profiles"]),
    );
    for (const w of ["download_link", "search_youtube", "queue_selection", "cancel_download"]) {
      expect(names).not.toContain(w);
    }
    const res = await mcpPost(app, reader, "tools/call", {
      name: "search_youtube",
      arguments: { query: "x" },
    });
    const body = (await res.json()) as { error?: unknown; result?: { isError?: boolean } };
    expect(body.error ?? body.result?.isError).toBeTruthy();
    const { n } = await testDb.db
      .selectFrom("download_requests")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("url", "like", "%search_query=x&%")
      .executeTakeFirstOrThrow();
    expect(n).toBe("0");
  });

  it("act as a member even for an admin: another person's download is not found", async () => {
    const id = await searchAndPick(secret, ["d1"]);
    const admin = await insertUser(testDb.db, { username: "mcpdladmin", role: "admin" });
    const adminToken = await mcpToken(testDb.db, admin);
    const r = await callTool(app, adminToken, "cancel_download", { downloadId: id });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^not_found: /);
    const theirs = await callTool(app, adminToken, "list_downloads", { ids: [id] });
    expect(theirs.structuredContent).toEqual({ downloads: [] });
  });
});
