import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryPage } from "@uroboros/contract";
import type { Insertable } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { MediaEditsTable } from "../db/editsSchema.ts";

/**
 * Searching a library with a person's own details (docs/library.md#your-own-details): their words
 * find the video and the site's words they replaced don't, while another holder searches the site's.
 */

const logger = pino({ level: "silent" });
let t: TestDb;
let alice: SignedIn;
let bob: SignedIn;
let shared: { alice: string; bob: string };
let titled: string;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await signedIn(t.db, { username: "esalice" });
  bob = await signedIn(t.db, { username: "esbob" });
  const media = { channel: "Castle Channel", description: "All about dragons in castles" };
  const a = await seedEntry(t.db, alice.userId, { videoId: "es-1", title: "Dragon lair", media });
  const b = await seedEntry(t.db, bob.userId, { videoId: "es-1", title: "Dragon lair", media });
  shared = { alice: a.entryId, bob: b.entryId };
  await edit(alice, a.mediaId, {
    title: "Kitten nap",
    description: "Warm milk and a blanket",
    channel: "Cozy Corner",
    channel_extractor: "youtube",
  });
  // Only its title edited: the site's description still finds it.
  const c = await seedEntry(t.db, alice.userId, {
    videoId: "es-2",
    title: "Site title",
    media: { description: "A zebra crossing" },
  });
  titled = c.entryId;
  await edit(alice, c.mediaId, { title: "Renamed" });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);
const search = async (s: SignedIn, q: string) => {
  const res = await app(s).request(`/api/library?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return LibraryPage.parse(await res.json()).entries;
};
const ids = async (s: SignedIn, q: string) => (await search(s, q)).map((e) => e.id);

type Edits = Omit<Insertable<MediaEditsTable>, "user_id" | "media_id">;
async function edit(s: SignedIn, mediaId: string, values: Edits) {
  await t.db
    .insertInto("media_edits")
    .values({ user_id: s.userId, media_id: mediaId, ...values })
    .execute();
}

describe("search with a person's own details", () => {
  it("finds a video by its edited title, and no longer by the site's", async () => {
    expect(await ids(alice, "kitten")).toEqual([shared.alice]);
    expect(await ids(alice, "dragon lair")).toEqual([]);
    expect(await ids(alice, "renamed")).toEqual([titled]);
    expect(await ids(alice, "site title")).toEqual([]);
  });

  it("finds it by the channel it was moved to, and no longer by the site's", async () => {
    expect(await ids(alice, "cozy corner")).toEqual([shared.alice]);
    expect(await ids(alice, "castle channel")).toEqual([]);
  });

  it("matches the edited description and shows it, and still the site's where it wasn't edited", async () => {
    const [hit] = await search(alice, "warm milk");
    expect(hit?.id).toBe(shared.alice);
    expect(hit?.match?.in).toBe("description");
    expect(hit?.match?.snippet.map((p) => p.text).join("")).toContain("Warm milk");
    expect(await ids(alice, "castles")).toEqual([]);
    expect(await ids(alice, "zebra")).toEqual([titled]);
  });

  it("leaves another holder of the same video searching the site's details", async () => {
    expect(await ids(bob, "dragon lair")).toEqual([shared.bob]);
    expect(await ids(bob, "castles")).toEqual([shared.bob]);
    expect(await ids(bob, "kitten")).toEqual([]);
  });
});
