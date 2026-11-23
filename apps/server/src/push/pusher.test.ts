import { generateVAPIDKeys } from "web-push";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserKeys, PushStub } from "../../test/pushStub.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { listDevices, upsertDevice } from "./devices.ts";
import { Pusher } from "./pusher.ts";
import { createPushSender } from "./sender.ts";

let USER: string;
let OTHER: string;
const keys = browserKeys();

let testDb: TestDb;
let stub: PushStub;
let pusher: Pusher;

beforeAll(async () => {
  testDb = await TestDb.create();
  stub = await PushStub.start();
  USER = await insertUser(testDb.db, { username: "user" });
  OTHER = await insertUser(testDb.db, { username: "other" });
  pusher = new Pusher({
    sender: createPushSender({ vapid: generateVAPIDKeys(), subject: "mailto:ops@u.example" }),
    db: testDb.db,
    baseUrl: "https://u.example",
    allowedHosts: ["127.0.0.1"],
    logger: pino({ level: "silent" }),
  });
});
afterAll(async () => {
  await stub.close();
  await testDb.close();
});
beforeEach(async () => {
  await testDb.db.deleteFrom("push_devices").execute();
  stub.requests.length = 0;
  stub.reply({ status: 201 });
});

const add = (userId: string, name: string, endpoint = stub.endpoint(name)) =>
  upsertDevice(testDb.db, { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, label: name });

describe("notify", () => {
  it("pushes to every device of the user and no one else's", async () => {
    await add(USER, "a");
    await add(USER, "b");
    await add(OTHER, "c");
    const sent = await pusher.notify(
      USER,
      { title: "Download failed", body: "x", path: "/downloads", tag: "download:1" },
      "high",
    );
    expect(sent).toEqual({ delivered: 2, gone: 0, failed: 0 });
    expect(stub.requests.map((r) => r.path).sort()).toEqual(["/push/a", "/push/b"]);
    expect(stub.requests[0]?.headers["urgency"]).toBe("high");
    expect(JSON.parse(keys.decrypt(stub.requests[0]?.body ?? Buffer.alloc(0)))).toMatchObject({
      notification: { navigate: "https://u.example/downloads", tag: "download:1" },
    });
  });

  it("counts gone and failed devices, forgetting the gone ones", async () => {
    await add(USER, "a");
    await add(USER, "b");
    stub.reply({ status: 410 }, { status: 400 });
    expect(await pusher.notify(USER, { title: "x", path: "/" }, "normal")).toEqual({
      delivered: 0,
      gone: 1,
      failed: 1,
    });
    const left = await listDevices(testDb.db, USER);
    expect(left).toHaveLength(1);
    expect(left[0]?.failed_at).toBeInstanceOf(Date);
  });

  it("forgets a stored device the allowlist no longer takes, without posting to it", async () => {
    await add(USER, "evil", "https://evil.example/push");
    expect(await pusher.notify(USER, { title: "x", path: "/" }, "normal")).toEqual({
      delivered: 0,
      gone: 1,
      failed: 0,
    });
    expect(stub.requests).toEqual([]);
    expect(await listDevices(testDb.db, USER)).toEqual([]);
  });
});

describe("link", () => {
  it("is absolute on the public origin", () => {
    expect(pusher.link("/downloads?id=1")).toBe("https://u.example/downloads?id=1");
    expect(pusher.link("settings")).toBe("https://u.example/settings");
  });
});
