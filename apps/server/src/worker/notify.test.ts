import { generateVAPIDKeys } from "web-push";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserKeys, PushStub } from "../../test/pushStub.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { upsertDevice } from "../push/devices.ts";
import { Pusher } from "../push/pusher.ts";
import { createPushSender } from "../push/sender.ts";
import { disabledPush, type PushService } from "../push/service.ts";
import { notifyProcessor } from "./notify.ts";

const logger = pino({ level: "silent" });
const keys = browserKeys();
let t: TestDb;
let stub: PushStub;
let push: PushService;
let userId: string;

beforeAll(async () => {
  t = await TestDb.create();
  stub = await PushStub.start();
  userId = await insertUser(t.db, { username: "notified" });
  const pusher = new Pusher({
    sender: createPushSender({ vapid: generateVAPIDKeys(), subject: "mailto:ops@u.example" }),
    db: t.db,
    baseUrl: "https://u.example",
    allowedHosts: ["127.0.0.1"],
    logger,
  });
  push = { maxDevices: 10, pusher: () => Promise.resolve(pusher) };
  await upsertDevice(t.db, {
    userId,
    endpoint: stub.endpoint("phone"),
    p256dh: keys.p256dh,
    auth: keys.auth,
    label: "phone",
  });
});
afterAll(async () => {
  await stub.close();
  await t.close();
});

const job = {
  data: {
    userId: "",
    message: {
      title: "2 new videos from Blender",
      path: "/subscriptions/x",
      tag: "subscription-x",
    },
    urgency: "normal" as const,
  },
};

describe("notify consumer", () => {
  it("sends a job's message to the user's devices", async () => {
    stub.reply({ status: 201 });
    await notifyProcessor(push, logger)({ data: { ...job.data, userId } });
    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(keys.decrypt(stub.requests[0]?.body ?? Buffer.alloc(0)))).toMatchObject({
      notification: {
        title: "2 new videos from Blender",
        navigate: "https://u.example/subscriptions/x",
        tag: "subscription-x",
      },
    });
  });

  it("drops jobs while push is off", async () => {
    const before = stub.requests.length;
    await notifyProcessor(disabledPush, logger)({ data: { ...job.data, userId } });
    expect(stub.requests).toHaveLength(before);
  });
});
