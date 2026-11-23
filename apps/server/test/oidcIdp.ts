import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export const CLIENT_ID = "uroboros";
export const CLIENT_SECRET = "test-secret";

/** How the next token response misbehaves. */
export type Forgery = "none" | "signature" | "hs256" | "nonce" | "issuer";

export interface Person {
  sub: string;
  name?: string;
  email?: string;
  groups?: string[];
}

interface PendingCode {
  person: Person;
  nonce: string;
  challenge: string;
  redirectUri: string;
}

export interface TestIdp {
  issuer: string;
  /** A fetch that trusts this provider's self-signed certificate (and nothing else). */
  fetch: (url: string, options: FetchOptions) => Promise<Response>;
  /** Simulates the user signing in at the provider: returns the code for the callback. */
  authorize(location: string, person: Person): string;
  /** A refresh token for `person`, as if they had signed in (for claims-sync tests). */
  issueRefresh(person: Person): string;
  /** Changes a person's groups (seen by the next refresh). */
  setGroups(sub: string, groups: string[]): void;
  /** Make every refresh answer invalid_grant (the user was removed). */
  refuseRefresh(on: boolean): void;
  /** Make the token endpoint answer 503 (provider down). */
  down(on: boolean): void;
  forge(kind: Forgery): void;
  /** Whether discovery is served (false: the provider is unreachable at start). */
  discoverable(on: boolean): void;
  refreshCount(): number;
  /** Whether a refresh answer carries an ID token (default true; false sends the client to userinfo). */
  refreshIdToken(on: boolean): void;
  /** Make the userinfo endpoint fail for this subject (null: fail for nobody). */
  userinfoFails(sub: string | null): void;
  /** Runs before each refresh is answered (null removes it), e.g. to sign the user in meanwhile. */
  onRefresh(hook: (() => Promise<void>) | null): void;
  /** Whether a sign-in's token answer carries a refresh token (default true). */
  issueRefreshOnSignIn(on: boolean): void;
  close(): Promise<void>;
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: unknown;
  signal?: AbortSignal | null;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** A throwaway self-signed certificate for 127.0.0.1, made with openssl. */
function selfSigned(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), "uroboros-idp-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** fetch over node:https, trusting only `ca`. */
function trustingFetch(ca: Buffer) {
  return (url: string, options: FetchOptions): Promise<Response> =>
    new Promise((resolve, reject) => {
      const headers =
        options.headers instanceof Headers
          ? Object.fromEntries(options.headers.entries())
          : (options.headers ?? {});
      const req = request(url, { method: options.method ?? "GET", headers, ca }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") out.set(k, v);
          }
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers: out }),
          );
        });
      });
      req.on("error", reject);
      options.signal?.addEventListener("abort", () => req.destroy(new Error("aborted")));
      if (typeof options.body === "string" || options.body instanceof URLSearchParams) {
        req.write(options.body.toString());
      }
      req.end();
    });
}

/** client_secret_basic: base64 of the form-urlencoded id and secret (RFC 6749 §2.3.1). */
function clientAuthenticated(header: string | undefined): boolean {
  const m = /^Basic (.+)$/.exec(header ?? "");
  if (m === null) return false;
  const [id = "", secret = ""] = Buffer.from(m[1] ?? "", "base64")
    .toString()
    .split(":");
  const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, " "));
  return decode(id) === CLIENT_ID && decode(secret) === CLIENT_SECRET;
}

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A minimal OIDC provider on loopback: discovery, JWKS, and a PKCE-checking token endpoint. */
export async function startIdp(): Promise<TestIdp> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const otherKey = (await generateKeyPair("ES256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const codes = new Map<string, PendingCode>();
  const refresh = new Map<string, Person>();
  const groups = new Map<string, string[]>();
  let forgery: Forgery = "none";
  let refuse = false;
  let isDown = false;
  let discover = true;
  let refreshes = 0;
  let issuer = "";
  let withIdToken = true;
  let failingUserinfo: string | null = null;
  let refreshHook: (() => Promise<void>) | null = null;
  let signInRefresh = true;
  const access = new Map<string, Person>();
  const accessToken = (person: Person) => {
    const at = b64url(randomBytes(16));
    access.set(at, person);
    return at;
  };

  async function idToken(person: Person, nonce: string | undefined): Promise<string> {
    const claims = {
      name: person.name,
      email: person.email,
      groups: groups.get(person.sub) ?? person.groups ?? [],
      ...(nonce === undefined ? {} : { nonce: forgery === "nonce" ? "wrong" : nonce }),
    };
    const jwt = new SignJWT(claims)
      .setIssuer(forgery === "issuer" ? "https://evil.example" : issuer)
      .setSubject(person.sub)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m");
    if (forgery === "hs256") {
      return jwt.setProtectedHeader({ alg: "HS256" }).sign(Buffer.from(CLIENT_SECRET));
    }
    if (forgery === "none") {
      return jwt.setProtectedHeader({ alg: "ES256", kid: "k1" }).sign(privateKey);
    }
    return jwt
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .sign(forgery === "signature" ? otherKey : privateKey);
  }

  async function refreshGrant(form: URLSearchParams, res: ServerResponse): Promise<void> {
    refreshes++;
    if (refreshHook !== null) await refreshHook();
    const person = refresh.get(form.get("refresh_token") ?? "");
    if (refuse || person === undefined) {
      send(res, 400, { error: "invalid_grant" });
      return;
    }
    refresh.delete(form.get("refresh_token") ?? "");
    const next = b64url(randomBytes(16));
    refresh.set(next, person);
    {
      send(res, 200, {
        access_token: accessToken(person),
        token_type: "Bearer",
        expires_in: 300,
        refresh_token: next,
        ...(withIdToken ? { id_token: await idToken(person, undefined) } : {}),
      });
      return;
    }
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (isDown) {
      send(res, 503, { error: "temporarily_unavailable" });
      return;
    }
    if (!clientAuthenticated(req.headers.authorization)) {
      {
        send(res, 401, { error: "invalid_client" });
        return;
      }
    }
    const form = await readBody(req);
    if (form.get("grant_type") === "refresh_token") {
      await refreshGrant(form, res);
      return;
    }
    const pending = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    if (pending === undefined) {
      send(res, 400, { error: "invalid_grant" });
      return;
    }
    const verifier = form.get("code_verifier") ?? "";
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    if (challenge !== pending.challenge || form.get("redirect_uri") !== pending.redirectUri) {
      {
        send(res, 400, { error: "invalid_grant" });
        return;
      }
    }
    const rt = b64url(randomBytes(16));
    if (signInRefresh) refresh.set(rt, pending.person);
    send(res, 200, {
      access_token: accessToken(pending.person),
      token_type: "Bearer",
      expires_in: 300,
      ...(signInRefresh ? { refresh_token: rt } : {}),
      id_token: await idToken(pending.person, pending.nonce),
    });
  }

  function userinfo(req: IncomingMessage, res: ServerResponse): void {
    const person = access.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (person === undefined) {
      send(res, 401, { error: "invalid_token" });
      return;
    }
    if (person.sub === failingUserinfo) {
      send(res, 500, { error: "server_error" });
      return;
    }
    send(res, 200, {
      sub: person.sub,
      name: person.name,
      email: person.email,
      groups: groups.get(person.sub) ?? person.groups ?? [],
    });
  }

  const tls = selfSigned();
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/.well-known/openid-configuration") {
      if (!discover) {
        send(res, 503, {});
        return;
      }
      {
        send(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/end-session`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["ES256"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
        return;
      }
    }
    if (path === "/userinfo") {
      userinfo(req, res);
      return;
    }
    if (path === "/jwks") {
      send(res, 200, { keys: [jwk] });
      return;
    }
    if (path === "/token" && req.method === "POST") {
      token(req, res).catch(() => {
        send(res, 500, {});
      });
      return;
    }
    send(res, 404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `https://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  return {
    issuer,
    fetch: trustingFetch(tls.cert),
    authorize(location, person) {
      const url = new URL(location);
      const code = b64url(randomBytes(16));
      codes.set(code, {
        person,
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
      });
      return code;
    },
    issueRefresh(person) {
      const rt = b64url(randomBytes(16));
      refresh.set(rt, person);
      return rt;
    },
    setGroups: (sub, g) => {
      groups.set(sub, g);
    },
    refuseRefresh: (on) => {
      refuse = on;
    },
    down: (on) => {
      isDown = on;
    },
    forge: (kind) => {
      forgery = kind;
    },
    discoverable: (on) => {
      discover = on;
    },
    refreshCount: () => refreshes,
    refreshIdToken: (on) => {
      withIdToken = on;
    },
    userinfoFails: (sub) => {
      failingUserinfo = sub;
    },
    onRefresh: (hook) => {
      refreshHook = hook;
    },
    issueRefreshOnSignIn: (on) => {
      signInRefresh = on;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
