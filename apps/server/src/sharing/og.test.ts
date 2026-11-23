import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertUser } from "../../test/users.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { fillIndex, ogTags } from "./og.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let owner: string;
let webDist: string;

beforeAll(async () => {
  t = await TestDb.create();
  owner = await insertUser(t.db, { username: "ogowner" });
  webDist = await mkdtemp(join(tmpdir(), "uroboros-og-web-"));
  await writeFile(
    join(webDist, "index.html"),
    "<!doctype html><html><head><title>Uroboros</title></head><body></body></html>",
  );
});
afterAll(async () => {
  await t.close();
});

async function linked(title: string, thumbnail = true) {
  const e = await seedEntry(t.db, owner, { title, thumbnail });
  await t.db
    .updateTable("media")
    .set({ description: "A short film about a rabbit." })
    .where("id", "=", e.mediaId)
    .execute();
  const code = `og${e.entryId.replaceAll("-", "")}`.slice(0, 22);
  await t.db
    .insertInto("shares")
    .values({ owner_id: owner, mode: "link", code, entry_id: e.entryId })
    .execute();
  return { code, entryId: e.entryId };
}

describe("link previews", () => {
  it("describes a live link with an absolute thumbnail", async () => {
    const { code, entryId } = await linked("Big Buck Bunny");
    const page = await ogTags(t.db, code, "https://uro.example");
    expect(page.title).toBe("Big Buck Bunny");
    expect(page.tags).toContain('<meta property="og:title" content="Big Buck Bunny">');
    expect(page.tags).toContain(
      '<meta property="og:description" content="A short film about a rabbit.">',
    );
    expect(page.tags).toContain(
      `<meta property="og:image" content="https://uro.example/api/public/s/${code}/items/${entryId}/thumbnail">`,
    );
    expect(page.tags).toContain(`<meta property="og:url" content="https://uro.example/s/${code}">`);
    expect(page.tags).toContain('<meta name="robots" content="noindex">');
  });

  it("a hostile title is escaped", async () => {
    const { code } = await linked('"><script>alert(1)</script>');
    const page = await ogTags(t.db, code, "https://uro.example");
    expect(page.tags).not.toContain("<script>");
    expect(page.tags).toContain("&quot;&gt;&lt;script&gt;");
    const html = fillIndex("<html><head><title>Uroboros</title></head></html>", page);
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Uroboros</title>",
    );
  });

  it("a dead code gives only the robots tag", async () => {
    const page = await ogTags(t.db, "nosuchcode000000000000", "https://uro.example");
    expect(page).toEqual({ title: null, tags: '<meta name="robots" content="noindex">' });
  });

  it("the app serves /s/<code> with the tags filled in", async () => {
    const { code } = await linked("Served film");
    const app = createApp(
      { db: t.db, valkey: {} as Redis, version: "t", logger },
      { webDist, publicBaseUrl: "https://uro.example" },
    );
    const res = await app.request(`/s/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Served film">');
    expect(html).toContain("<title>Served film · Uroboros</title>");
    const plain = await (await app.request("/library")).text();
    expect(plain).not.toContain("og:title");
  });
});
