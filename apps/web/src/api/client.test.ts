import { Health, Info, type ApiErrorBody } from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getJson } from "./client";

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
    respondWith(Response.json({ name: "uroboros", version: "1.2.3" }));

    await expect(getJson("/api/info", Info)).resolves.toEqual({
      name: "uroboros",
      version: "1.2.3",
    });
  });

  it("sends Accept: application/json and forwards the abort signal", async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(Response.json({ status: "ok", failing: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await getJson("/api/health", Health, { signal });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/health");
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

    const error: unknown = await getJson("/api/health", Health).catch((e: unknown) => e);

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
