import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../config.ts";
import { DEFAULT_LAYOUT } from "./config.ts";

const base = { DATABASE_URL: "postgres://u:p@h/db" };
const s3 = {
  UROBOROS_STORAGE: "s3",
  UROBOROS_S3_ENDPOINT: "http://rustfs:9000",
  UROBOROS_S3_BUCKET: "uroboros",
  UROBOROS_S3_ACCESS_KEY_ID: "id",
  UROBOROS_S3_SECRET_ACCESS_KEY: "secret",
};

describe("storage settings", () => {
  it("requires UROBOROS_STORAGE", () => {
    expect(() => loadConfig(base)).toThrow(/UROBOROS_STORAGE/);
  });

  it("reads S3 with its defaults", () => {
    expect(loadConfig({ ...base, ...s3 }).storage).toEqual({
      kind: "s3",
      endpoint: "http://rustfs:9000",
      region: "us-east-1",
      bucket: "uroboros",
      accessKeyId: "id",
      secretAccessKey: "secret",
      forcePathStyle: true,
      publicUrl: null,
    });
  });

  it.each([
    "UROBOROS_S3_ENDPOINT",
    "UROBOROS_S3_BUCKET",
    "UROBOROS_S3_ACCESS_KEY_ID",
    "UROBOROS_S3_SECRET_ACCESS_KEY",
  ])("names a missing %s", (name) => {
    const env: Record<string, string> = { ...base, ...s3 };
    env[name] = "";
    expect(() => loadConfig(env)).toThrow(new RegExp(name));
  });

  it("reads the filesystem backend with the default layout", () => {
    expect(
      loadConfig({ ...base, UROBOROS_STORAGE: "filesystem", UROBOROS_STORAGE_ROOT: "/media" })
        .storage,
    ).toEqual({ kind: "filesystem", root: "/media", layout: DEFAULT_LAYOUT });
  });

  it("needs an absolute filesystem root", () => {
    expect(() =>
      loadConfig({ ...base, UROBOROS_STORAGE: "filesystem", UROBOROS_STORAGE_ROOT: "media" }),
    ).toThrow(/UROBOROS_STORAGE_ROOT/);
  });

  it("refuses a layout with an unknown token, naming it", () => {
    expect(() =>
      loadConfig({
        ...base,
        UROBOROS_STORAGE: "filesystem",
        UROBOROS_STORAGE_ROOT: "/media",
        UROBOROS_STORAGE_LAYOUT: "{channel}/{nope}.{ext}",
      }),
    ).toThrow(/\{nope\}/);
  });

  it.each(["{channel}/{title} [{profile}].{ext}", "{channel}/{title} [{id}].{ext}"])(
    "refuses a layout %s that could put two files on one path",
    (layout) => {
      expect(() =>
        loadConfig({
          ...base,
          UROBOROS_STORAGE: "filesystem",
          UROBOROS_STORAGE_ROOT: "/media",
          UROBOROS_STORAGE_LAYOUT: layout,
        }),
      ).toThrow(/UROBOROS_STORAGE_LAYOUT/);
    },
  );

  it("refuses an unknown backend", () => {
    expect(() => loadConfig({ ...base, UROBOROS_STORAGE: "ftp" })).toThrow(ConfigError);
  });

  it("defaults the download limits to 3 active per user, 1000 preview entries, 10 GiB uploads", () => {
    expect(loadConfig({ ...base, ...s3 }).downloads).toEqual({
      maxActivePerUser: 3,
      maxPlaylistEntries: 1000,
      minCheckIntervalMinutes: 60,
      uploadMaxBytes: 10 * 1024 ** 3,
    });
  });

  it("takes an upload cap up to 10,000 parts of 8 MiB", () => {
    const cap = (v: string) =>
      loadConfig({ ...base, ...s3, UROBOROS_UPLOAD_MAX_BYTES: v }).downloads.uploadMaxBytes;
    expect(cap("1048576")).toBe(1048576);
    expect(cap(String(8 * 1024 * 1024 * 10_000))).toBe(8 * 1024 * 1024 * 10_000);
    expect(() => cap(String(8 * 1024 * 1024 * 10_000 + 1))).toThrow(/UROBOROS_UPLOAD_MAX_BYTES/);
    expect(() => cap("0")).toThrow(/UROBOROS_UPLOAD_MAX_BYTES/);
  });

  it("gives the job consumers their work dir, and no credentials of the server's own", () => {
    const c = loadConfig({ ...base, ...s3, UROBOROS_WORK_DIR: "/work" });
    expect(c.worker.workDir).toBe("/work");
    // Credentials are people's own (Settings › Logins), never the whole server's.
    expect(c.worker).not.toHaveProperty("cookiesFile");
    expect(c.storage.kind).toBe("s3");
  });

  it("reads the subtitle settings: English with automatic captions by default, empty turns them off", () => {
    expect(loadConfig({ ...base, ...s3 }).worker.subtitles).toEqual({
      langs: "en.*",
      automatic: true,
    });
    expect(
      loadConfig({ ...base, ...s3, UROBOROS_AUTO_SUBTITLES: "false" }).worker.subtitles.automatic,
    ).toBe(false);
    // compose passes an empty value when it is unset.
    expect(
      loadConfig({ ...base, ...s3, UROBOROS_AUTO_SUBTITLES: "" }).worker.subtitles.automatic,
    ).toBe(true);
    expect(
      loadConfig({ ...base, ...s3, UROBOROS_SUBTITLE_LANGS: "" }).worker.subtitles.langs,
    ).toBeNull();
    expect(
      loadConfig({
        ...base,
        ...s3,
        UROBOROS_SUBTITLE_LANGS: "de,fr",
        UROBOROS_AUTO_SUBTITLES: "true",
      }).worker.subtitles,
    ).toEqual({ langs: "de,fr", automatic: true });
    expect(() => loadConfig({ ...base, ...s3, UROBOROS_SUBTITLE_LANGS: "en; rm" })).toThrow(
      /UROBOROS_SUBTITLE_LANGS/,
    );
    // Room for the ",-.*-orig" automatic captions add, within yt-dlp's 200 characters.
    expect(
      loadConfig({ ...base, ...s3, UROBOROS_SUBTITLE_LANGS: "x".repeat(190) }).worker.subtitles
        .langs,
    ).toHaveLength(190);
    expect(() => loadConfig({ ...base, ...s3, UROBOROS_SUBTITLE_LANGS: "x".repeat(191) })).toThrow(
      /UROBOROS_SUBTITLE_LANGS/,
    );
  });
});
