import type { Upload } from "@uroboros/contract";
import { describe, expect, it } from "vitest";

import { copyFixture, downloadFixture } from "@/test/activity";
import { subscriptionFixture } from "@/test/subscriptions";
import type { LocalUpload } from "@/uploads/UploadProvider";

import { workItems } from "./work";

const progress = {
  phase: "downloading" as const,
  percent: 42,
  downloadedBytes: 42,
  totalBytes: 100,
  speed: 1024,
  eta: 30,
};

const upload = (over: Partial<Upload>): Upload => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000b1",
  filename: "film.mp4",
  title: "Holiday film",
  size: 1000,
  partSize: 1000,
  state: "processing",
  receivedParts: [],
  error: null,
  entryId: null,
  createdAt: "2026-11-24T18:00:00.000Z",
  ...over,
});

const none = {
  downloads: [],
  progress: new Map(),
  local: new Map<string, LocalUpload>(),
  uploads: [],
  copies: [],
  subscriptions: [],
  previews: null,
};

describe("workItems", () => {
  it("takes the live progress of a running download, and none for a queued one", () => {
    const running = downloadFixture();
    const queued = downloadFixture({ id: "q", state: "queued", fetchKey: "fetch|q" });
    const done = downloadFixture({ id: "d", state: "done" });
    const items = workItems({
      ...none,
      downloads: [running, queued, done],
      progress: new Map([
        [running.fetchKey, progress],
        ["fetch|q", progress],
      ]),
    });
    expect(items).toEqual([
      { kind: "download", id: running.id, download: running, progress },
      { kind: "download", id: "q", download: queued, progress: null },
    ]);
  });

  it("puts this tab's uploads first, then those the server is processing, once each", () => {
    const sending: LocalUpload = {
      id: "s",
      title: "Sending",
      size: 100,
      sent: 40,
      state: "sending",
      error: null,
      entryId: null,
    };
    const finished: LocalUpload = { ...sending, id: "f", state: "done" };
    const items = workItems({
      ...none,
      local: new Map([
        ["s", sending],
        ["f", finished],
      ]),
      uploads: [
        upload({ id: "s", state: "receiving" }),
        upload({ id: "p" }),
        upload({ id: "x", state: "failed" }),
      ],
    });
    expect(items.map((i) => [i.kind, i.id, i.kind === "upload" ? i.sent : null])).toEqual([
      ["upload", "s", 40],
      ["upload", "p", null],
    ]);
  });

  it("lists copies being made and subscriptions being checked", () => {
    const making = copyFixture();
    const items = workItems({
      ...none,
      copies: [making, copyFixture({ id: "done", state: "done" })],
      subscriptions: [subscriptionFixture({ checking: true }), subscriptionFixture({ id: "idle" })],
    });
    expect(items).toEqual([
      { kind: "copy", id: making.id, copy: making },
      { kind: "check", id: subscriptionFixture().id, title: "Blender" },
    ]);
  });

  it("shows the hover previews being made as one row, last, and none while none wait", () => {
    const work = { queued: 30, left: 400, made: 100, next: null };
    expect(workItems({ ...none, previews: { ...work, queued: 0 } })).toEqual([]);
    const items = workItems({ ...none, copies: [copyFixture()], previews: work });
    expect(items.at(-1)).toEqual({ kind: "previews", id: "previews", work });
    expect(items).toHaveLength(2);
  });
});
