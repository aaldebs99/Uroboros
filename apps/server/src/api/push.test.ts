import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  PushDevice,
  PushEndpointStatus,
  PushTestResult,
  PushView,
} from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserKeys, PushStub } from "../../test/pushStub.ts";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { createPushService, type PushSettings } from "../push/service.ts";
import { createApp } from "./app.ts";

const logger = pino({ level: "silent" });
const keys = browserKeys();

let testDb: TestDb;
let stub: PushStub;
let session: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  session = await signedIn(testDb.db, { username: "pushy" });
  stub = await PushStub.start();
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

const settings = (over: Partial<PushSettings> = {}): PushSettings => ({
  publicBaseUrl: "https://uroboros.example",
  subject: null,
  vapid: null,
  allowedHosts: ["127.0.0.1"],
  maxDevices: 2,
  ...over,
});

function app(over: Partial<PushSettings> = {}): OpenAPIHono {
  const push = createPushService(settings(over), testDb.db, logger);
  return asUser(
    createApp({ db: testDb.db, version: "0", logger, push }, { webDist: null }),
    session,
  );
}

const body = (name: string, label = "Firefox on Linux") => ({
  endpoint: stub.endpoint(name),
  p256dh: keys.p256dh,
  auth: keys.auth,
  label,
});

function post(a: OpenAPIHono, path: string, json?: unknown) {
  return a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

async function register(a: OpenAPIHono, name: string): Promise<PushDevice> {
  const res = await post(a, "/api/me/push/devices", body(name));
  expect(res.status).toBe(200);
  return PushDevice.parse(await res.json());
}

async function errorCode(res: Response): Promise<string> {
  return ApiErrorBody.parse(await res.json()).code;
}

describe("GET /api/me/push", () => {
  it("is enabled with a generated key and no devices", async () => {
    const res = await app().request("/api/me/push");
    expect(res.status).toBe(200);
    const view = PushView.parse(await res.json());
    expect(view).toMatchObject({ enabled: true, devices: [], maxDevices: 2 });
    const row = await testDb.db.selectFrom("vapid_keys").select("public_key").executeTakeFirst();
    expect(view.publicKey).toBe(row?.public_key);
  });

  it("is disabled without an https public base URL", async () => {
    for (const publicBaseUrl of [null, "http://uroboros.example"]) {
      const view = PushView.parse(
        await (await app({ publicBaseUrl }).request("/api/me/push")).json(),
      );
      expect(view).toMatchObject({ enabled: false, publicKey: null });
    }
  });
});

describe("POST /api/me/push/devices", () => {
  it("registers a device owned by the signed-in user and lists it", async () => {
    const a = app();
    const device = await register(a, "one");
    expect(device).toMatchObject({
      label: "Firefox on Linux",
      lastSuccessAt: null,
      failedAt: null,
    });
    const row = await testDb.db.selectFrom("push_devices").selectAll().executeTakeFirstOrThrow();
    expect(row.user_id).toBe(session.userId);
    const view = PushView.parse(await (await a.request("/api/me/push")).json());
    expect(view.devices).toEqual([device]);
  });

  it("updates the device on a known endpoint instead of adding one", async () => {
    const a = app();
    const first = await register(a, "one");
    const res = await post(a, "/api/me/push/devices", body("one", "  Renamed  "));
    const again = PushDevice.parse(await res.json());
    expect(again.id).toBe(first.id);
    expect(again.label).toBe("Renamed");
  });

  it("names an unlabelled device and cuts a long label", async () => {
    const a = app({ maxDevices: 5 });
    const blank = PushDevice.parse(
      await (await post(a, "/api/me/push/devices", body("a", " "))).json(),
    );
    expect(blank.label).toBe("This device");
    const long = PushDevice.parse(
      await (await post(a, "/api/me/push/devices", body("b", "x".repeat(300)))).json(),
    );
    expect(long.label).toHaveLength(64);
  });

  it("refuses an endpoint that is not on an allowed push service (400)", async () => {
    const res = await post(
      app({ allowedHosts: ["fcm.googleapis.com"] }),
      "/api/me/push/devices",
      body("x"),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("bad_request");
    expect(await testDb.db.selectFrom("push_devices").selectAll().execute()).toEqual([]);
  });

  it("refuses a malformed body (400)", async () => {
    const res = await post(app(), "/api/me/push/devices", { endpoint: "x" });
    expect(res.status).toBe(400);
  });

  it("refuses while push is off (409)", async () => {
    const res = await post(app({ publicBaseUrl: null }), "/api/me/push/devices", body("x"));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("conflict");
  });

  it("refuses a device over the cap (422) but still updates a known one", async () => {
    const a = app();
    await register(a, "one");
    await register(a, "two");
    const res = await post(a, "/api/me/push/devices", body("three"));
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("unprocessable");
    expect((await post(a, "/api/me/push/devices", body("two"))).status).toBe(200);
  });
});

describe("DELETE /api/me/push/devices/{id}", () => {
  it("removes the device, then 404s", async () => {
    const a = app();
    const device = await register(a, "one");
    const path = `/api/me/push/devices/${device.id}`;
    expect((await a.request(path, { method: "DELETE" })).status).toBe(204);
    const again = await a.request(path, { method: "DELETE" });
    expect(again.status).toBe(404);
    expect(await errorCode(again)).toBe("not_found");
  });

  it("refuses an id that is not a uuid (400)", async () => {
    expect((await app().request("/api/me/push/devices/nope", { method: "DELETE" })).status).toBe(
      400,
    );
  });

  it("works while push is off, so a person can always turn a device off", async () => {
    const device = await register(app(), "one");
    const res = await app({ publicBaseUrl: null }).request(`/api/me/push/devices/${device.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/me/push/devices/{id}/test", () => {
  async function test(a: OpenAPIHono, id: string) {
    const res = await post(a, `/api/me/push/devices/${id}/test`);
    const json: unknown = await res.json();
    return { res, json };
  }

  it("delivers a declarative test push and records the success", async () => {
    const a = app();
    const device = await register(a, "one");
    const { res, json } = await test(a, device.id);
    expect(res.status).toBe(200);
    expect(PushTestResult.parse(json)).toEqual({ outcome: "delivered" });
    expect(stub.requests[0]?.headers["urgency"]).toBe("normal");
    expect(JSON.parse(keys.decrypt(stub.requests[0]?.body ?? Buffer.alloc(0)))).toEqual({
      web_push: 8030,
      notification: {
        title: "Uroboros",
        body: "Notifications are on for this device.",
        navigate: "https://uroboros.example/settings",
        tag: "uroboros-test",
      },
    });
    const row = await testDb.db.selectFrom("push_devices").selectAll().executeTakeFirstOrThrow();
    expect(row.last_success_at).toBeInstanceOf(Date);
  });

  it("forgets a device its push service says is gone", async () => {
    const a = app();
    const device = await register(a, "one");
    stub.reply({ status: 410 });
    expect((await test(a, device.id)).json).toEqual({ outcome: "gone" });
    expect(await testDb.db.selectFrom("push_devices").selectAll().execute()).toEqual([]);
  });

  it("marks a device whose push was refused", async () => {
    const a = app();
    const device = await register(a, "one");
    stub.reply({ status: 400 });
    expect((await test(a, device.id)).json).toEqual({ outcome: "failed" });
    const view = PushView.parse(await (await a.request("/api/me/push")).json());
    expect(view.devices[0]?.failedAt).not.toBeNull();
  });

  it("404s for an unknown device and 409s while push is off", async () => {
    const a = app();
    const missing = await test(a, "0190a3f2-7c1e-7000-8000-000000000001");
    expect(missing.res.status).toBe(404);
    const device = await register(a, "one");
    expect((await test(app({ publicBaseUrl: null }), device.id)).res.status).toBe(409);
  });
});

describe("openapi", () => {
  it("documents the push routes", async () => {
    const doc = (await (await app().request("/api/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/me/push",
        "/api/me/push/devices",
        "/api/me/push/devices/{id}",
        "/api/me/push/devices/{id}/test",
      ]),
    );
  });
});

describe("ownership and races", () => {
  it("never lets concurrent registrations exceed the cap", async () => {
    await testDb.db.deleteFrom("push_devices").execute();
    const a = app({ maxDevices: 3 });
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) =>
        post(a, "/api/me/push/devices", body(`race${String(i)}`)),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(17);
    const { n } = await testDb.db
      .selectFrom("push_devices")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", session.userId)
      .executeTakeFirstOrThrow();
    expect(n).toBe("3");
  });

  it("refuses an endpoint another user registered (409) instead of taking it over", async () => {
    const other = await signedIn(testDb.db, { username: `push-other-${String(Date.now())}` });
    const otherApp = asUser(
      createApp(
        {
          db: testDb.db,
          version: "0",
          logger,
          push: createPushService(settings(), testDb.db, logger),
        },
        { webDist: null },
      ),
      other,
    );
    expect((await post(otherApp, "/api/me/push/devices", body("shared"))).status).toBe(200);
    const res = await post(app(), "/api/me/push/devices", body("shared"));
    expect(res.status).toBe(409);
    const row = await testDb.db
      .selectFrom("push_devices")
      .select("user_id")
      .where("endpoint", "=", stub.endpoint("shared"))
      .executeTakeFirstOrThrow();
    expect(row.user_id).toBe(other.userId);
  });

  it("remembers a device turned off elsewhere until it is turned on again", async () => {
    const a = app();
    const device = PushDevice.parse(
      await (await post(a, "/api/me/push/devices", body("phone"))).json(),
    );
    const status = async () =>
      PushEndpointStatus.parse(
        await (
          await a.request(
            `/api/me/push/devices/status?endpoint=${encodeURIComponent(stub.endpoint("phone"))}`,
          )
        ).json(),
      );
    expect(await status()).toEqual({ known: true, turnedOffElsewhere: false });
    expect(
      (await a.request(`/api/me/push/devices/${device.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(await status()).toEqual({ known: false, turnedOffElsewhere: true });
    expect((await post(a, "/api/me/push/devices", body("phone"))).status).toBe(200);
    expect(await status()).toEqual({ known: true, turnedOffElsewhere: false });
  });
});
