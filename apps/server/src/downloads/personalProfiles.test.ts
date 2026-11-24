import { randomUUID } from "node:crypto";
import { DownloadRequest, FormatProfile } from "@uroboros/contract";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, post } from "../../test/downloads.ts";
import { insertSubscription } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { markOrphans, sweepRenditions } from "../storage/reaper.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  alice = await signedIn(testDb.db, { username: "ppalice" });
  bob = await signedIn(testDb.db, { username: "ppbob" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  h.app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

async function list(s: SignedIn): Promise<FormatProfile[]> {
  return z.array(FormatProfile).parse(await (await send(s, "GET", "/api/format-profiles")).json());
}

async function own(s: SignedIn, name = `p-${randomUUID().slice(0, 8)}`): Promise<FormatProfile> {
  const res = await send(s, "POST", "/api/format-profiles", { name, format: "b[height<=720]" });
  expect(res.status).toBe(201);
  return FormatProfile.parse(await res.json());
}

const defaultOf = async (s: SignedIn) => (await list(s)).find((p) => p.isDefault)?.name;

describe("personal format profiles", () => {
  it("shows a person their own after the built-ins, and nobody else", async () => {
    const mine = await own(alice, "Mine 720p");
    const names = (await list(alice)).map((p) => [p.name, p.builtIn]);
    expect(names.at(-1)).toEqual(["Mine 720p", false]);
    expect((await list(bob)).map((p) => p.id)).not.toContain(mine.id);
    expect(
      (await send(bob, "PATCH", `/api/format-profiles/${mine.id}`, { format: "b" })).status,
    ).toBe(404);
    expect((await send(bob, "DELETE", `/api/format-profiles/${mine.id}`)).status).toBe(404);
  });

  it("refuses someone else's profile for a download or a subscription (400)", async () => {
    const mine = await own(alice);
    const download = await post(h.app(bob), "/api/downloads", {
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      profileId: mine.id,
    });
    expect(download.status).toBe(400);
    const builtIn = (await list(bob)).find((p) => p.builtIn);
    const sub = await insertSubscription(testDb.db, {
      userId: bob.userId,
      profileId: builtIn?.id ?? "",
      feeds: [{ name: "Videos", url: "https://www.youtube.com/@b/videos" }],
      sourceId: `UC-${randomUUID()}`,
    });
    const patched = await send(bob, "PATCH", `/api/subscriptions/${sub}`, { profileId: mine.id });
    expect(patched.status).toBe(400);
    // Alice's own is fine for Alice.
    const hers = await post(h.app(alice), "/api/downloads", {
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      profileId: mine.id,
    });
    expect(hers.status).toBe(202);
  });

  it("downloads with the person's own default, else the built-in one", async () => {
    const carol = await signedIn(testDb.db, { username: "ppcarol" });
    expect(await defaultOf(carol)).toBe("Best available");
    const mine = await own(carol, "Carol's");
    expect(
      (await send(carol, "PUT", "/api/format-profiles/default", { profileId: mine.id })).status,
    ).toBe(204);
    expect(await defaultOf(carol)).toBe("Carol's");
    // Everyone else keeps theirs.
    expect(await defaultOf(bob)).toBe("Best available");
    const req = DownloadRequest.parse(
      await (
        await post(h.app(carol), "/api/downloads", { url: "https://www.youtube.com/watch?v=x" })
      ).json(),
    );
    expect(req.profileId).toBe(mine.id);

    const audio = (await list(carol)).find((p) => p.name === "Audio only (Opus)");
    await send(carol, "PUT", "/api/format-profiles/default", { profileId: audio?.id });
    expect(await defaultOf(carol)).toBe("Audio only (Opus)");
    await send(carol, "PUT", "/api/format-profiles/default", { profileId: mine.id });
    // Deleting their default falls back to the built-in one. (The request above used it: drop it.)
    await testDb.db.deleteFrom("download_requests").where("id", "=", req.id).execute();
    expect((await send(carol, "DELETE", `/api/format-profiles/${mine.id}`)).status).toBe(204);
    expect(await defaultOf(carol)).toBe("Best available");
  });

  it("edits a built-in into the person's own copy, for them alone, taking their subscriptions and default along", async () => {
    const erin = await signedIn(testDb.db, { username: "pperin" });
    const best = (await list(erin)).find((p) => p.name === "Best available");
    const sub = await insertSubscription(testDb.db, {
      userId: erin.userId,
      profileId: best?.id ?? "",
      feeds: [{ name: "Videos", url: "https://www.youtube.com/@e/videos" }],
      sourceId: `UC-${randomUUID()}`,
    });
    const res = await send(erin, "PATCH", `/api/format-profiles/${best?.id ?? ""}`, {
      format: "b[height<=480]",
    });
    expect(res.status).toBe(200);
    const copy = FormatProfile.parse(await res.json());
    expect(copy).toMatchObject({
      name: "Best available",
      builtIn: false,
      isDefault: true,
      format: "b[height<=480]",
    });
    expect(copy.id).not.toBe(best?.id);
    const hers = await list(erin);
    expect(hers.filter((p) => p.name === "Best available").map((p) => p.id)).toEqual([copy.id]);
    const row = await testDb.db
      .selectFrom("subscriptions")
      .select("profile_id")
      .where("id", "=", sub)
      .executeTakeFirstOrThrow();
    expect(row.profile_id).toBe(copy.id);
    // Everyone else keeps the built-in, as it was.
    const bobs = (await list(bob)).find((p) => p.name === "Best available");
    expect(bobs).toMatchObject({ id: best?.id, builtIn: true, format: "bv*+ba/b" });
  });

  it("deletes a built-in for the person alone, and frees its name for them", async () => {
    const fay = await signedIn(testDb.db, { username: "ppfay" });
    const audio = (await list(fay)).find((p) => p.name === "Audio only (Opus)");
    expect((await send(fay, "DELETE", `/api/format-profiles/${audio?.id ?? ""}`)).status).toBe(204);
    expect((await list(fay)).map((p) => p.name)).not.toContain("Audio only (Opus)");
    expect((await list(bob)).map((p) => p.name)).toContain("Audio only (Opus)");
    // Hidden from her: not usable either, and its name is hers to give.
    const download = await post(h.app(fay), "/api/downloads", {
      url: "https://www.youtube.com/watch?v=f",
      profileId: audio?.id,
    });
    expect(download.status).toBe(400);
    await own(fay, "Audio only (Opus)");
  });

  it("keeps a built-in a person's subscriptions follow, and their last profile (409)", async () => {
    const gus = await signedIn(testDb.db, { username: "ppgus" });
    const [first, second, third] = await list(gus);
    await insertSubscription(testDb.db, {
      userId: gus.userId,
      profileId: first?.id ?? "",
      feeds: [{ name: "Videos", url: "https://www.youtube.com/@g/videos" }],
      sourceId: `UC-${randomUUID()}`,
    });
    expect((await send(gus, "DELETE", `/api/format-profiles/${first?.id ?? ""}`)).status).toBe(409);
    expect((await send(gus, "DELETE", `/api/format-profiles/${second?.id ?? ""}`)).status).toBe(
      204,
    );
    await testDb.db.deleteFrom("subscriptions").where("user_id", "=", gus.userId).execute();
    expect((await send(gus, "DELETE", `/api/format-profiles/${first?.id ?? ""}`)).status).toBe(204);
    // One left: it stays, and it is what they download with.
    expect((await send(gus, "DELETE", `/api/format-profiles/${third?.id ?? ""}`)).status).toBe(409);
    expect((await list(gus)).map((p) => [p.id, p.isDefault])).toEqual([[third?.id, true]]);
  });

  it("refuses someone else's profile as a default (404)", async () => {
    const mine = await own(alice);
    const res = await send(bob, "PUT", "/api/format-profiles/default", { profileId: mine.id });
    expect(res.status).toBe(404);
  });

  it("deletes an account with profiles in use, leaving its files for the reaper", async () => {
    const dave = await signedIn(testDb.db, { username: "ppdave" });
    const mine = await own(dave);
    await send(dave, "PUT", "/api/format-profiles/default", { profileId: mine.id });
    const media = await testDb.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: randomUUID().slice(0, 11) })
      .returning("id")
      .executeTakeFirstOrThrow();
    const rendition = await testDb.db
      .insertInto("renditions")
      .values({
        media_id: media.id,
        profile_id: mine.id,
        profile_revision: mine.revision,
        storage_key: `k/${randomUUID()}`,
        size_bytes: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("library_entries")
      .values({ user_id: dave.userId, media_id: media.id, rendition_id: rendition.id })
      .execute();
    await insertSubscription(testDb.db, {
      userId: dave.userId,
      profileId: mine.id,
      feeds: [{ name: "Videos", url: "https://www.youtube.com/@d/videos" }],
      sourceId: `UC-${randomUUID()}`,
    });
    await post(h.app(dave), "/api/downloads", { url: "https://www.youtube.com/watch?v=d" });

    await testDb.db.deleteFrom("users").where("id", "=", dave.userId).execute();

    const left = await testDb.db
      .selectFrom("renditions")
      .select("profile_id")
      .where("id", "=", rendition.id)
      .executeTakeFirstOrThrow();
    expect(left.profile_id).toBeNull();
    await markOrphans(testDb.db);
    await sweepRenditions(testDb.db, -1000);
    const gone = await testDb.db
      .selectFrom("renditions")
      .select("id")
      .where("id", "=", rendition.id)
      .executeTakeFirst();
    expect(gone).toBeUndefined();
  });
});
