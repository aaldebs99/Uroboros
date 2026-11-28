import { describe, expect, it } from "vitest";
import { AdminHealth } from "./index.ts";

describe("Admin › Health", () => {
  const sample = {
    version: "0.1.5",
    replicas: [
      {
        id: "0b9c8f4e-8f7e-4a43-9b1f-2a6f1d6b1c11",
        host: "uroboros-1",
        version: "0.1.5",
        startedAt: "2026-11-27T10:00:00.000Z",
        seenAt: "2026-11-27T12:00:00.000Z",
        leader: true,
        status: "degraded",
        failing: ["storage"],
        runningJobs: 2,
        current: true,
      },
    ],
    cooldowns: [
      {
        site: "youtube.com",
        scope: "site",
        until: "2026-11-27T12:05:00.000Z",
        strikes: 3,
        active: true,
        waitingDownloads: 4,
        waitingLinks: 1,
      },
    ],
    events: [
      {
        id: "5d6a8f7e-1c2b-4d3e-8f9a-0b1c2d3e4f50",
        at: "2026-11-27T12:01:00.000Z",
        site: "youtube.com",
        scope: "site",
        source: "download",
        message: "HTTP Error 429: Too Many Requests",
        url: "https://www.youtube.com/watch?v=x",
        title: "A video",
        entryId: null,
        until: "2026-11-27T12:05:00.000Z",
        hinted: false,
        strikes: 3,
      },
    ],
  };

  it("parses a report", () => {
    expect(AdminHealth.parse(sample)).toEqual(sample);
  });

  it("knows only its replica states, checks and kinds of work", () => {
    const replica = sample.replicas[0];
    const event = sample.events[0];
    expect(() =>
      AdminHealth.parse({ ...sample, replicas: [{ ...replica, status: "sleeping" }] }),
    ).toThrow();
    expect(() =>
      AdminHealth.parse({ ...sample, replicas: [{ ...replica, failing: ["valkey"] }] }),
    ).toThrow();
    expect(() =>
      AdminHealth.parse({ ...sample, events: [{ ...event, source: "upload" }] }),
    ).toThrow();
  });
});
