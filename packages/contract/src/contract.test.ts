import { describe, expect, expectTypeOf, it } from "vitest";
import { ApiErrorBody, ApiErrorCode, Health, type Info, apiErrorStatus } from "./index.ts";

describe("contract", () => {
  it("parses a valid error body and rejects an unknown code", () => {
    expect(ApiErrorBody.parse({ code: "not_found", message: "x" }).code).toBe("not_found");
    expect(() => ApiErrorBody.parse({ code: "teapot", message: "x" })).toThrow();
  });

  it("parses a degraded health report", () => {
    expect(Health.parse({ status: "degraded", failing: ["valkey"] }).failing).toEqual(["valkey"]);
  });

  it("maps every error code to a status in enum order", () => {
    expect(Object.keys(apiErrorStatus).sort()).toEqual(ApiErrorCode.options.slice().sort());
    expect(ApiErrorCode.options.map((c) => apiErrorStatus[c])).toEqual([
      400, 401, 403, 404, 409, 500, 503,
    ]);
  });

  it("types Info.name as the uroboros literal", () => {
    expectTypeOf<Info["name"]>().toEqualTypeOf<"uroboros">();
  });
});
