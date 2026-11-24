import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ApiErrorBody,
  ApiErrorCode,
  type Info,
  Liveness,
  Readiness,
  apiErrorStatus,
} from "./index.ts";

describe("contract", () => {
  it("parses a valid error body and rejects an unknown code", () => {
    expect(ApiErrorBody.parse({ code: "not_found", message: "x" }).code).toBe("not_found");
    expect(() => ApiErrorBody.parse({ code: "teapot", message: "x" })).toThrow();
  });

  it("parses a degraded readiness report, which can only name the database", () => {
    expect(Readiness.parse({ status: "degraded", failing: ["database"] }).failing).toEqual([
      "database",
    ]);
    expect(() => Readiness.parse({ status: "degraded", failing: ["valkey"] })).toThrow();
  });

  it("parses a replica that is still starting", () => {
    expect(Readiness.parse({ status: "starting", failing: [] }).status).toBe("starting");
  });

  it("has liveness say ok and nothing else", () => {
    expect(Liveness.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(() => Liveness.parse({ status: "degraded" })).toThrow();
  });

  it("maps every error code to a status in enum order", () => {
    expect(Object.keys(apiErrorStatus).sort()).toEqual(ApiErrorCode.options.slice().sort());
    expect(ApiErrorCode.options.map((c) => apiErrorStatus[c])).toEqual([
      400, 401, 403, 404, 409, 413, 422, 429, 500, 503,
    ]);
  });

  it("types Info.name as the uroboros literal", () => {
    expectTypeOf<Info["name"]>().toEqualTypeOf<"uroboros">();
  });
});
