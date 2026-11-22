import { createECDH, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** One request the stub push service received. */
export interface StubRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** What the stub answers with; the queue's last entry repeats. */
export interface StubReply {
  status: number;
  headers?: Record<string, string>;
}

/**
 * A push service on 127.0.0.1, so no test ever reaches a real one. Answers each request with the
 * next queued reply (201 when nothing is queued) and records it.
 */
export class PushStub {
  readonly requests: StubRequest[] = [];
  private replies: StubReply[] = [];
  private server: Server | null = null;
  private port = 0;

  static async start(): Promise<PushStub> {
    const stub = new PushStub();
    stub.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        stub.requests.push({
          method: req.method ?? "",
          path: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        const reply = stub.replies.length > 1 ? stub.replies.shift() : stub.replies[0];
        res.writeHead(reply?.status ?? 201, reply?.headers ?? {});
        res.end();
      });
    });
    await new Promise<void>((resolve) => stub.server?.listen(0, "127.0.0.1", resolve));
    stub.port = (stub.server.address() as AddressInfo).port;
    return stub;
  }

  /** An endpoint on this stub; `name` keeps endpoints of one test apart. */
  endpoint(name = "device"): string {
    return `http://127.0.0.1:${String(this.port)}/push/${name}`;
  }

  /** Sets the replies for the next requests, in order. */
  reply(...replies: StubReply[]): void {
    this.replies = replies;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }
}

/** A browser's side of a subscription: its P-256 key pair and auth secret. */
export interface BrowserKeys {
  p256dh: string;
  auth: string;
  decrypt(body: Buffer): string;
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * Keys for a fake browser, and RFC 8291 `aes128gcm` decryption with them, so a test reads what
 * a real browser would and the sender's encryption is checked end to end.
 */
export function browserKeys(): BrowserKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const uaPublic = ecdh.getPublicKey();
  const auth = randomBytes(16);
  return {
    p256dh: uaPublic.toString("base64url"),
    auth: auth.toString("base64url"),
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const idLength = body.readUInt8(20);
      const asPublic = body.subarray(21, 21 + idLength);
      const cipher = body.subarray(21 + idLength);
      const secret = ecdh.computeSecret(asPublic);
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
      const ikm = hmac(hmac(auth, secret), Buffer.concat([info, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(cipher.subarray(cipher.length - 16));
      const padded = Buffer.concat([
        decipher.update(cipher.subarray(0, cipher.length - 16)),
        decipher.final(),
      ]);
      // The last record ends with a 0x02 delimiter followed by zero padding.
      return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
    },
  };
}
