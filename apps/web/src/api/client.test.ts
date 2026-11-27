import {
  ApiErrorCode,
  Info,
  PushTestResult,
  Readiness,
  type ApiErrorBody,
} from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ApiError,
  deleteJson,
  errorText,
  getJson,
  postJson,
  putBytesWithProgress,
  setUnauthorizedHandler,
} from "./client";
import { fakeXhr } from "@/test/fakeXhr";

function respondWith(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
}

async function failure(path: string): Promise<ApiError> {
  const error: unknown = await getJson(path, Info).catch((e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getJson success", () => {
  it("returns the body parsed by the schema", async () => {
    respondWith(Response.json({ name: "uroboros", version: "1.2.3", publicBaseUrl: null }));

    // The schema's defaults too: an answer without clips reads as clips off.
    await expect(getJson("/api/info", Info)).resolves.toEqual({
      name: "uroboros",
      version: "1.2.3",
      publicBaseUrl: null,
      clips: false,
    });
  });

  it("sends Accept: application/json and forwards the abort signal", async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ status: "ok", failing: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await getJson("/api/ready", Readiness, { signal });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/ready");
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });
});

describe("getJson errors", () => {
  it("parses a typed ApiErrorBody", async () => {
    const body: ApiErrorBody = { code: "not_found", message: "no such API route: /api/nope" };
    respondWith(Response.json(body, { status: 404 }));

    const error = await failure("/api/nope");
    expect(error.status).toBe(404);
    expect(error.body).toEqual(body);
    expect(error.code).toBe("not_found");
    expect(error.message).toBe("GET /api/nope failed: 404 not_found: no such API route: /api/nope");
  });

  it("tolerates a non-JSON body", async () => {
    respondWith(
      new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );

    const error = await failure("/api/info");
    expect(error.status).toBe(502);
    expect(error.body).toBeNull();
    expect(error.code).toBeNull();
    expect(error.message).toBe("GET /api/info failed: 502 Bad Gateway");
  });

  it("does not trust JSON that is not an ApiErrorBody", async () => {
    respondWith(Response.json({ code: "teapot", message: "short and stout" }, { status: 418 }));

    const error = await failure("/api/info");
    expect(error.body).toBeNull();
    expect(error.code).toBeNull();
  });

  it("throws ApiError with a null code when a 200 body fails the schema", async () => {
    respondWith(Response.json({ status: "weird" }));

    const error: unknown = await getJson("/api/ready", Readiness).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(200);
    expect((error as ApiError).code).toBeNull();
    expect((error as ApiError).body).toBeNull();
  });

  it("throws ApiError when a 200 body is not JSON", async () => {
    respondWith(new Response("<html>spa fallback</html>", { status: 200 }));

    const error: unknown = await getJson("/api/info", Info).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBeNull();
  });
});

describe("postJson", () => {
  it("sends the body as JSON and parses the answer", async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ outcome: "delivered" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(postJson("/api/x", PushTestResult, { a: 1 })).resolves.toEqual({
      outcome: "delivered",
    });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/x");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("sends no body when given none", async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ outcome: "gone" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await postJson("/api/x", PushTestResult);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("names the method in a typed failure", async () => {
    const body: ApiErrorBody = { code: "unprocessable", message: "too many devices" };
    respondWith(Response.json(body, { status: 422 }));

    const error: unknown = await postJson("/api/x", PushTestResult, {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("unprocessable");
    expect((error as ApiError).message).toBe(
      "POST /api/x failed: 422 unprocessable: too many devices",
    );
  });
});

describe("deleteJson", () => {
  it("accepts a 204 with no body", async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteJson("/api/x/1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("throws the typed error", async () => {
    respondWith(Response.json({ code: "not_found", message: "no such device" }, { status: 404 }));

    const error: unknown = await deleteJson("/api/x/1").catch((e: unknown) => e);

    expect((error as ApiError).code).toBe("not_found");
  });
});

describe("errorText", () => {
  it("says something for every code and for no code", () => {
    for (const code of ApiErrorCode.options) {
      expect(errorText(new ApiError(400, "x", { code, message: "m" }))).not.toBe("");
    }
    expect(errorText(new ApiError(502, "x"))).toMatch(/server/i);
    expect(errorText(new TypeError("fetch failed"))).toMatch(/reach/i);
  });

  it("passes the server's message through for a refusal it explains", () => {
    expect(
      errorText(new ApiError(422, "x", { code: "unprocessable", message: "turn one off first" })),
    ).toBe("turn one off first");
  });
});

describe("auth plumbing", () => {
  afterEach(() => {
    document.cookie = "uroboros_csrf=; max-age=0; path=/";
    setUnauthorizedHandler(null);
  });

  it("sends the CSRF cookie back as a header on writes, and not on reads", async () => {
    document.cookie = "uroboros_csrf=abc123; path=/";
    const seen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    await deleteJson("/api/x");
    await getJson("/api/y", z.unknown()).catch(() => undefined);
    expect(seen[0]?.get("x-uroboros-csrf")).toBe("abc123");
    expect(seen[1]?.get("x-uroboros-csrf")).toBeNull();
  });

  it("tells the registered handler about any 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ code: "unauthorized", message: "sign in required" }, { status: 401 }),
        ),
      ),
    );
    await expect(getJson("/api/me/push", z.unknown())).rejects.toThrow();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("putBytesWithProgress (an upload's parts)", () => {
  const part = new Blob(["0123456789"], { type: "video/mp4" });
  afterEach(() => {
    document.cookie = "uroboros_csrf=; max-age=0; path=/";
    setUnauthorizedHandler(null);
  });

  it("sends the CSRF header and the part's type, and hears the bytes go", async () => {
    document.cookie = "uroboros_csrf=abc123; path=/";
    const sent = fakeXhr();
    const progress: number[] = [];
    await putBytesWithProgress("/api/uploads/u/parts/1", part, {
      onProgress: (n) => progress.push(n),
    });
    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/uploads/u/parts/1",
        size: 10,
        headers: expect.objectContaining({
          "X-Uroboros-CSRF": "abc123",
          "Content-Type": "video/mp4",
        }) as Record<string, string>,
      },
    ]);
    expect(progress).toEqual([10]);
  });

  it("tells the registered handler about a 401, and rejects with the typed error", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fakeXhr(() => ({
      status: 401,
      body: JSON.stringify({ code: "unauthorized", message: "sign in required" }),
    }));
    const error: unknown = await putBytesWithProgress("/api/uploads/u/parts/1", part).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("unauthorized");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects a failed part with the server's error, and a lost network as a TypeError", async () => {
    fakeXhr(() => ({
      status: 409,
      body: JSON.stringify({ code: "conflict", message: "that part is already stored" }),
    }));
    const refused: unknown = await putBytesWithProgress("/api/uploads/u/parts/1", part).catch(
      (e: unknown) => e,
    );
    expect(refused).toMatchObject({ code: "conflict" });
    fakeXhr(() => "network-error");
    await expect(putBytesWithProgress("/api/uploads/u/parts/1", part)).rejects.toThrow(TypeError);
  });

  it("rejects as an AbortError when cancelled before or during the send", async () => {
    fakeXhr(() => new Promise(() => undefined));
    await expect(
      putBytesWithProgress("/api/uploads/u/parts/1", part, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const stop = new AbortController();
    const sending = putBytesWithProgress("/api/uploads/u/parts/1", part, { signal: stop.signal });
    stop.abort();
    await expect(sending).rejects.toMatchObject({ name: "AbortError" });
  });
});
