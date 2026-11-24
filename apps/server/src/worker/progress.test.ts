import type { ProgressEvent } from "@uroboros/ytdlp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBus } from "../../test/bus.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import { latestProgress } from "../downloads/events.ts";
import { createProgressPublisher } from "./progress.ts";

let t: TestDb;
let bus: PgBus;
let heard: { progress: { phase: string; downloadedBytes: number | null } }[];

beforeEach(async () => {
  t = await TestDb.create();
  bus = testBus(t);
  await bus.ready;
  heard = [];
  bus.on("uroboros_downloads", (p) => heard.push(JSON.parse(p) as (typeof heard)[number]));
});

afterEach(async () => {
  await bus.close();
  await t.close();
});

const base = {
  videoId: null,
  filename: null,
  totalIsEstimate: false,
  speed: 1,
  eta: 1,
  elapsed: 1,
  fragmentIndex: null,
  fragmentCount: null,
  postprocessor: null,
} as const;

const downloading = (bytes: number): ProgressEvent => ({
  ...base,
  phase: "downloading",
  state: "running",
  downloadedBytes: bytes,
  totalBytes: 20,
});

describe("progress", () => {
  it("publishes at most two per second plus every phase change", async () => {
    const publish = createProgressPublisher(t.db, "k");
    for (let i = 0; i < 20; i++) publish(downloading(i));
    publish({
      ...base,
      phase: "merging",
      state: "started",
      downloadedBytes: null,
      totalBytes: null,
    });
    await vi.waitFor(() => {
      expect(heard.some((m) => m.progress.phase === "merging")).toBe(true);
    });
    expect(heard.length).toBeLessThanOrEqual(3);
  });

  it("sends one write at a time, the newest waiting one winning", async () => {
    const publish = createProgressPublisher(t.db, "k");
    // Phase changes pass the throttle, so all four arrive while the first write is in flight.
    publish(downloading(1));
    publish({ ...base, phase: "merging", state: "started", downloadedBytes: 2, totalBytes: null });
    publish(downloading(3));
    publish({ ...base, phase: "merging", state: "started", downloadedBytes: 4, totalBytes: null });
    await vi.waitFor(async () => {
      expect((await latestProgress(t.db, ["k"])).get("k")?.downloadedBytes).toBe(4);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(heard.map((m) => m.progress.downloadedBytes)).toEqual([1, 4]);
  });
});
