import type { DownloadProgress } from "@uroboros/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBus } from "../../test/bus.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PgBus } from "../db/notifications.ts";
import {
  latestProgress,
  publishCancel,
  publishDownloadEvents,
  saveProgress,
  sweepExpiredProgress,
} from "./events.ts";

let t: TestDb;
let bus: PgBus;

beforeEach(async () => {
  t = await TestDb.create();
  bus = testBus(t);
  await bus.ready;
});

afterEach(async () => {
  await bus.close();
  await t.close();
});

const progress = (percent: number): DownloadProgress => ({
  phase: "downloading",
  percent,
  downloadedBytes: percent,
  totalBytes: 100,
  speed: 1,
  eta: 1,
});

describe("download events", () => {
  it("keeps a fetch's latest progress for a minute, then sweeps it", async () => {
    await saveProgress(t.db, "fetch|a", progress(10));
    await saveProgress(t.db, "fetch|a", progress(20));
    await saveProgress(t.db, "fetch|b", progress(5));
    const now = await latestProgress(t.db, ["fetch|a", "fetch|b", "fetch|c"]);
    expect(Object.fromEntries([...now].map(([k, p]) => [k, p.percent]))).toEqual({
      "fetch|a": 20,
      "fetch|b": 5,
    });
    await t.db
      .updateTable("download_progress")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("fetch_key", "=", "fetch|a")
      .execute();
    expect([...(await latestProgress(t.db, ["fetch|a", "fetch|b"])).keys()]).toEqual(["fetch|b"]);
    expect(await sweepExpiredProgress(t.db)).toBe(1);
    expect(await t.db.selectFrom("download_progress").select("fetch_key").execute()).toEqual([
      { fetch_key: "fetch|b" },
    ]);
  });

  it("tells every replica about saved progress", async () => {
    const heard: unknown[] = [];
    bus.on("uroboros_downloads", (p) => heard.push(JSON.parse(p)));
    await saveProgress(t.db, "fetch|a", progress(30));
    await vi.waitFor(() => {
      expect(heard).toEqual([{ kind: "progress", fetchKey: "fetch|a", progress: progress(30) }]);
    });
  });

  it("publishes state events and cancels on their channels", async () => {
    const states: unknown[] = [];
    const cancels: unknown[] = [];
    bus.on("uroboros_downloads", (p) => states.push(JSON.parse(p)));
    bus.on("uroboros_cancel", (p) => cancels.push(JSON.parse(p)));
    await publishDownloadEvents(t.db, [
      { kind: "state", downloadId: "d1", userId: "u1" },
      { kind: "state", downloadId: "d2", userId: "u1" },
    ]);
    await publishCancel(t.db, "fetch|x");
    await vi.waitFor(() => {
      expect(states).toEqual([
        { kind: "state", downloadId: "d1", userId: "u1" },
        { kind: "state", downloadId: "d2", userId: "u1" },
      ]);
      expect(cancels).toEqual([{ fetchKey: "fetch|x" }]);
    });
  });
});
