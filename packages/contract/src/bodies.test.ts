import { describe, expect, it } from "vitest";
import {
  FormatProfilePatch,
  GroupMembersBody,
  McpUpdateEntryInput,
  NewApiTokenBody,
  NewDownloadBody,
  NewFormatProfileBody,
  NewGroupBody,
  NewPlaylistBody,
  NewUploadBody,
  PeopleShareBody,
  PlaylistHiddenBody,
  PlaylistItemsBody,
  PlaylistMoveBody,
  PreferencesPatch,
  PublicLinkBody,
  SponsorBlockChoice,
  TagsBody,
} from "./index.ts";

/**
 * What the request bodies refuse and how they normalize what they take: every server route
 * validates with these, so a rule lost here is a rule lost on the server.
 */

const uuid = "0190a3f2-7c1e-7000-8000-000000000001";
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("NewUploadBody", () => {
  const base = { filename: "clip.mp4", size: 10, title: "Clip" };

  it("takes a minimal upload, with no tags", () => {
    expect(NewUploadBody.parse(base)).toMatchObject({ ...base, tags: [] });
  });

  it("reads a blank description as none, and trims the title and creator", () => {
    expect(
      NewUploadBody.parse({ ...base, title: "  Clip  ", creator: " Me ", description: "   " }),
    ).toMatchObject({ title: "Clip", creator: "Me", description: null });
  });

  it("keeps each tag once", () => {
    expect(NewUploadBody.parse({ ...base, tags: ["Music", "music", " live "] }).tags).toEqual([
      "music",
      "live",
    ]);
  });

  it("refuses an empty name or title, a size that is not a positive whole number, and an overlong creator", () => {
    expect(ok(NewUploadBody, { ...base, filename: "" })).toBe(false);
    expect(ok(NewUploadBody, { ...base, title: "   " })).toBe(false);
    expect(ok(NewUploadBody, { ...base, size: 0 })).toBe(false);
    expect(ok(NewUploadBody, { ...base, size: 1.5 })).toBe(false);
    expect(ok(NewUploadBody, { ...base, title: "x".repeat(201) })).toBe(false);
    expect(ok(NewUploadBody, { ...base, creator: "x".repeat(101) })).toBe(false);
    expect(ok(NewUploadBody, { ...base, description: "x".repeat(5001) })).toBe(false);
  });
});

describe("sharing bodies", () => {
  it("PeopleShareBody takes up to 100 users or groups, and an expiry with its offset", () => {
    const person = { kind: "user", id: uuid };
    expect(ok(PeopleShareBody, { people: [], expiresAt: null })).toBe(true);
    expect(
      ok(PeopleShareBody, { people: [person, { kind: "group", id: uuid }], expiresAt: null }),
    ).toBe(true);
    expect(
      ok(PeopleShareBody, { people: Array.from({ length: 100 }, () => person), expiresAt: null }),
    ).toBe(true);
    expect(
      ok(PeopleShareBody, { people: Array.from({ length: 101 }, () => person), expiresAt: null }),
    ).toBe(false);
    expect(ok(PeopleShareBody, { people: [{ kind: "team", id: uuid }], expiresAt: null })).toBe(
      false,
    );
    expect(ok(PeopleShareBody, { people: [{ kind: "user", id: "bob" }], expiresAt: null })).toBe(
      false,
    );
  });

  it("an expiry must say its offset: a bare local time is ambiguous", () => {
    for (const expiresAt of ["2026-12-01T00:00:00Z", "2026-12-01T00:00:00+01:00"]) {
      expect([expiresAt, ok(PublicLinkBody, { allowDownload: false, expiresAt })]).toEqual([
        expiresAt,
        true,
      ]);
    }
    for (const expiresAt of ["2026-12-01T00:00:00", "2026-12-01", "tomorrow"]) {
      expect([expiresAt, ok(PublicLinkBody, { allowDownload: false, expiresAt })]).toEqual([
        expiresAt,
        false,
      ]);
    }
    expect(ok(PublicLinkBody, { expiresAt: null })).toBe(false);
  });
});

describe("group bodies", () => {
  it("a group's name is trimmed and not blank", () => {
    expect(NewGroupBody.parse({ name: "  Family " })).toEqual({ name: "Family" });
    expect(ok(NewGroupBody, { name: "   " })).toBe(false);
  });

  it("adds 1 to 100 people by id", () => {
    expect(ok(GroupMembersBody, { userIds: [uuid] })).toBe(true);
    expect(ok(GroupMembersBody, { userIds: [] })).toBe(false);
    expect(ok(GroupMembersBody, { userIds: Array.from({ length: 101 }, () => uuid) })).toBe(false);
    expect(ok(GroupMembersBody, { userIds: ["bob"] })).toBe(false);
  });
});

describe("playlist bodies", () => {
  it("a playlist's name is trimmed, 1 to 100 characters", () => {
    expect(NewPlaylistBody.parse({ name: " Later " })).toEqual({ name: "Later" });
    expect(ok(NewPlaylistBody, { name: "" })).toBe(false);
    expect(ok(NewPlaylistBody, { name: "x".repeat(101) })).toBe(false);
  });

  it("holds at most 5000 entries, by id", () => {
    expect(ok(PlaylistItemsBody, { entryIds: Array.from({ length: 5000 }, () => uuid) })).toBe(
      true,
    );
    expect(ok(PlaylistItemsBody, { entryIds: Array.from({ length: 5001 }, () => uuid) })).toBe(
      false,
    );
    expect(ok(PlaylistItemsBody, { entryIds: ["x"] })).toBe(false);
  });

  it("moves to a whole position from 0", () => {
    expect(ok(PlaylistMoveBody, { position: 0 })).toBe(true);
    expect(ok(PlaylistMoveBody, { position: -1 })).toBe(false);
    expect(ok(PlaylistMoveBody, { position: 1.5 })).toBe(false);
  });
});

describe("tags and preferences", () => {
  it("TagsBody keeps each tag once, after lower-casing", () => {
    expect(TagsBody.parse({ tags: ["Live", "live", "LIVE", "music"] })).toEqual({
      tags: ["live", "music"],
    });
  });

  it("a SponsorBlock choice keeps each category once, in one order, and only known ones", () => {
    expect(
      SponsorBlockChoice.parse({ show: ["sponsor", "intro", "sponsor"], skip: ["outro"] }),
    ).toEqual({ show: ["intro", "sponsor"], skip: ["outro"] });
    expect(ok(SponsorBlockChoice, { show: ["ads"], skip: [] })).toBe(false);
  });

  it("a preferences patch may change one thing alone", () => {
    const none = { show: [], skip: [] };
    expect(PreferencesPatch.parse({ sponsorBlock: { video: none, audio: none } })).toEqual({
      sponsorBlock: { video: none, audio: none },
    });
    expect(ok(PreferencesPatch, { sponsorBlock: "all" })).toBe(false);
  });

  it("a preferences patch no longer carries Hide playlist videos, now each playlist's own", () => {
    expect(PreferencesPatch.parse({ hidePlaylistVideos: true })).toEqual({});
  });

  it("a playlist is hidden from the library or not, nothing else", () => {
    expect(PlaylistHiddenBody.parse({ hidden: true })).toEqual({ hidden: true });
    expect(ok(PlaylistHiddenBody, { hidden: "yes" })).toBe(false);
    expect(ok(PlaylistHiddenBody, {})).toBe(false);
  });
});

describe("NewApiTokenBody scopes", () => {
  it("defaults to the REST API, read and write", () => {
    expect(NewApiTokenBody.parse({ name: "cron" })).toEqual({
      name: "cron",
      scopes: ["api"],
      readOnly: false,
    });
  });

  it("keeps each scope once, sorted, and refuses none or an unknown one", () => {
    expect(NewApiTokenBody.parse({ name: "x", scopes: ["mcp", "api", "mcp"] }).scopes).toEqual([
      "api",
      "mcp",
    ]);
    expect(ok(NewApiTokenBody, { name: "x", scopes: [] })).toBe(false);
    expect(ok(NewApiTokenBody, { name: "x", scopes: ["admin"] })).toBe(false);
  });
});

describe("format profile words (they reach yt-dlp's arguments)", () => {
  const base = { name: "Mine", format: "b" };

  it("takes a short lower-case container or codec name", () => {
    expect(
      NewFormatProfileBody.parse({ ...base, mergeFormat: "mkv", audioFormat: "opus" }),
    ).toMatchObject({ mergeFormat: "mkv", audioFormat: "opus" });
    expect(NewFormatProfileBody.parse(base)).toMatchObject({
      mergeFormat: null,
      audioFormat: null,
    });
  });

  it("refuses anything that could be read as another argument or a path", () => {
    for (const word of ["mp4 --exec rm", "--exec", "../x", "MP4", "", "a".repeat(17), "mp4;"]) {
      expect([word, ok(NewFormatProfileBody, { ...base, mergeFormat: word })]).toEqual([
        word,
        false,
      ]);
      expect([word, ok(FormatProfilePatch, { audioFormat: word })]).toEqual([word, false]);
    }
  });
});

describe("other bodies", () => {
  it("NewDownloadBody takes http(s) links only", () => {
    expect(ok(NewDownloadBody, { url: "https://www.youtube.com/watch?v=x" })).toBe(true);
    expect(ok(NewDownloadBody, { url: "http://example.com/v.mp4" })).toBe(true);
    for (const url of ["file:///etc/passwd", "ftp://example.com/v", "javascript:alert(1)", "x"]) {
      expect([url, ok(NewDownloadBody, { url })]).toEqual([url, false]);
    }
  });

  it("an MCP entry update must change something", () => {
    expect(ok(McpUpdateEntryInput, { entryId: uuid })).toBe(false);
    expect(ok(McpUpdateEntryInput, { entryId: uuid, kept: false })).toBe(true);
    expect(ok(McpUpdateEntryInput, { entryId: uuid, tags: [] })).toBe(true);
  });
});
