import { generateVAPIDKeys } from "web-push";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserKeys, PushStub } from "../../test/pushStub.ts";
import { buildPayload, encodePayload } from "./payload.ts";
import { createPushSender, type PushSender } from "./sender.ts";

const vapid = generateVAPIDKeys();
const keys = browserKeys();
const payload = encodePayload(
  buildPayload({ title: "Uroboros", body: "hi", navigate: "https://u.example/" }),
);

let stub: PushStub;
let sender: PushSender;
const waits: number[] = [];

beforeAll(async () => {
  stub = await PushStub.start();
  sender = createPushSender({
    vapid,
    subject: "https://u.example",
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
});
afterAll(() => stub.close());
beforeEach(() => {
  stub.requests.length = 0;
  waits.length = 0;
  stub.reply({ status: 201 });
});

const sub = (name = "device") => ({ endpoint: stub.endpoint(name), ...keys });

describe("send", () => {
  it("posts an aes128gcm body the browser can read, with VAPID, TTL and Urgency", async () => {
    expect(await sender.send(sub(), payload, "high")).toEqual({ kind: "delivered" });
    const [req] = stub.requests;
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/push/device");
    expect(req?.headers["content-encoding"]).toBe("aes128gcm");
    expect(req?.headers["content-type"]).toBe("application/octet-stream");
    expect(req?.headers["ttl"]).toBe("86400");
    expect(req?.headers["urgency"]).toBe("high");
    expect(req?.headers.authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    expect(JSON.parse(keys.decrypt(req?.body ?? Buffer.alloc(0)))).toEqual(JSON.parse(payload));
  });

  it("names the push service's origin as the JWT audience and the subject as contact", async () => {
    await sender.send(sub(), payload, "normal");
    const jwt = /t=([^,]+)/.exec(String(stub.requests[0]?.headers.authorization))?.[1] ?? "";
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as {
      aud: string;
      sub: string;
    };
    expect(claims.aud).toBe(new URL(stub.endpoint()).origin);
    expect(claims.sub).toBe("https://u.example");
    expect(stub.requests[0]?.headers["urgency"]).toBe("normal");
  });

  it.each([404, 410])("reports %i as gone", async (status) => {
    stub.reply({ status });
    expect(await sender.send(sub(), payload, "normal")).toEqual({ kind: "gone", status });
  });

  it("retries once when a busy service says how soon", async () => {
    stub.reply({ status: 429, headers: { "retry-after": "2" } }, { status: 201 });
    expect(await sender.send(sub(), payload, "normal")).toEqual({ kind: "delivered" });
    expect(stub.requests).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it("gives up after the one retry", async () => {
    stub.reply({ status: 503, headers: { "retry-after": "1" } });
    expect(await sender.send(sub(), payload, "normal")).toEqual({
      kind: "failed",
      error: "the push service is busy (503)",
    });
    expect(stub.requests).toHaveLength(2);
  });

  it("does not wait out a Retry-After over 5 s, nor retry without one", async () => {
    stub.reply({ status: 429, headers: { "retry-after": "6" } });
    expect(await sender.send(sub(), payload, "normal")).toEqual({ kind: "rejected", status: 429 });
    stub.reply({ status: 500 });
    expect(await sender.send(sub(), payload, "normal")).toEqual({ kind: "rejected", status: 500 });
    expect(stub.requests).toHaveLength(2);
    expect(waits).toEqual([]);
  });

  it("does not follow a redirect", async () => {
    stub.reply({ status: 307, headers: { location: "http://127.0.0.1:1/elsewhere" } });
    expect(await sender.send(sub(), payload, "normal")).toEqual({ kind: "rejected", status: 307 });
    expect(stub.requests).toHaveLength(1);
  });

  it("reports an unreachable service as failed", async () => {
    const outcome = await sender.send(
      { endpoint: "http://127.0.0.1:1/push/x", ...keys },
      payload,
      "normal",
    );
    expect(outcome.kind).toBe("failed");
  });

  it("exposes the public key browsers subscribe with", () => {
    expect(sender.publicKey).toBe(vapid.publicKey);
  });
});
