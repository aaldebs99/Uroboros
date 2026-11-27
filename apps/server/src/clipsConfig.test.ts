import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const base = {
  DATABASE_URL: "postgres://u:p@h/db",
  UROBOROS_STORAGE: "filesystem",
  UROBOROS_STORAGE_ROOT: "/media",
  UROBOROS_BOOTSTRAP_USERNAME: "admin",
  UROBOROS_BOOTSTRAP_PASSWORD: "correct horse battery",
};

describe("loadConfig clips", () => {
  it("lets people make clips unless UROBOROS_CLIPS_ENABLED is false", () => {
    expect(loadConfig(base).clipsEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_CLIPS_ENABLED: "" }).clipsEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_CLIPS_ENABLED: "true" }).clipsEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_CLIPS_ENABLED: "false" }).clipsEnabled).toBe(false);
  });

  it("names UROBOROS_CLIPS_ENABLED when it is neither true nor false", () => {
    expect(() => loadConfig({ ...base, UROBOROS_CLIPS_ENABLED: "yes" })).toThrow(
      /UROBOROS_CLIPS_ENABLED must be true or false/,
    );
  });
});
