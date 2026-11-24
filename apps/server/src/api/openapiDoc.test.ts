import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/schema.ts";
import { createApp } from "./app.ts";
import { openApiConfig } from "./openapiDoc.ts";

/** The document as `gen` writes it. */
function doc() {
  const app = createApp({ db: {} as Kysely<Database>, version: "t" }, { webDist: null });
  return app.getOpenAPIDocument(openApiConfig("t")) as unknown as {
    info: { description?: string };
    security?: unknown;
    components?: { securitySchemes?: Record<string, unknown> };
    paths: Record<string, Record<string, { security?: unknown }>>;
  };
}

describe("the API document", () => {
  it("declares token (with the REST scope) and cookie sign-in for every operation by default", () => {
    const d = doc();
    expect(d.components?.securitySchemes).toMatchObject({
      bearerAuth: { type: "http", scheme: "bearer" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "uroboros_session" },
    });
    expect(d.security).toEqual([{ bearerAuth: ["api"] }, { cookieAuth: [] }]);
  });

  it("marks the routes anyone may call", () => {
    const d = doc();
    expect(d.paths["/api/health"]?.get?.security).toEqual([]);
    expect(d.paths["/api/auth/local/login"]?.post?.security).toEqual([]);
    expect(d.paths["/api/auth/oidc/callback"]?.get?.security).toEqual([]);
    expect(d.paths["/api/public/s/{code}"]?.get?.security).toEqual([]);
    expect(d.paths["/api/library"]?.get?.security).toBeUndefined();
  });

  it("explains tokens, the CSRF header, errors and paging", () => {
    const text = doc().info.description ?? "";
    expect(text).toContain("Authorization: Bearer");
    expect(text).toContain("X-Uroboros-CSRF");
    expect(text).toContain("ApiErrorBody");
    expect(text).toContain("nextCursor");
    expect(text).toContain("/api/downloads/events");
  });
});
