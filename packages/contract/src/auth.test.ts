import { describe, expect, it } from "vitest";
import {
  AdminUserPatch,
  LocalLoginBody,
  Me,
  NewApiTokenBody,
  NewLocalUserBody,
  Username,
} from "./index.ts";

describe("auth wire schemas", () => {
  it("LocalLoginBody needs both fields", () => {
    expect(LocalLoginBody.safeParse({ username: "a" }).success).toBe(false);
    expect(LocalLoginBody.safeParse({ username: "a", password: "b" }).success).toBe(true);
  });

  it("Username is lower-case [a-z0-9._-], 1–64 chars, after trimming", () => {
    expect(Username.parse("  alice.b-c_1 ")).toBe("alice.b-c_1");
    expect(Username.safeParse("Bad Name").success).toBe(false);
    expect(Username.safeParse("x".repeat(65)).success).toBe(false);
  });

  it("NewLocalUserBody refuses an 11-character password and a bad username", () => {
    const ok = {
      username: "tv",
      displayName: "Living room",
      role: "member",
      password: "a".repeat(12),
    };
    expect(NewLocalUserBody.safeParse(ok).success).toBe(true);
    expect(NewLocalUserBody.safeParse({ ...ok, password: "a".repeat(11) }).success).toBe(false);
    expect(NewLocalUserBody.safeParse({ ...ok, username: "Bad Name" }).success).toBe(false);
  });

  it("AdminUserPatch accepts an empty patch and refuses an unknown role", () => {
    expect(AdminUserPatch.safeParse({}).success).toBe(true);
    expect(AdminUserPatch.safeParse({ role: "owner" }).success).toBe(false);
  });

  it("NewApiTokenBody names are 1–64 characters", () => {
    expect(NewApiTokenBody.safeParse({ name: "" }).success).toBe(false);
    expect(NewApiTokenBody.safeParse({ name: "x".repeat(65) }).success).toBe(false);
  });

  it("Me carries the method and role", () => {
    const me = {
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Alex",
      email: null,
      role: "admin",
      method: "oidc",
      isBootstrap: false,
    };
    expect(Me.parse(me)).toEqual(me);
  });
});
