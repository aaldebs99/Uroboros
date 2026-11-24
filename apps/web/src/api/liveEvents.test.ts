import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followLiveEvents, type LiveMessage } from "./liveEvents";

/** A stand-in EventSource the test can open, push through and drop. */
class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  open() {
    this.onopen?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  drop() {
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

/** Channels by name: a post reaches every other open instance, as between tabs. */
class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.open) {
      if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent<unknown>);
    }
  }
  close() {
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
}

/** One exclusive lock: the next waiter gets it once the holder's promise settles. */
function fakeLocks() {
  const waiting: { grant: () => void }[] = [];
  let held = false;
  const next = () => {
    const w = waiting.shift();
    if (w === undefined) {
      held = false;
      return;
    }
    w.grant();
  };
  return {
    request(_name: string, opts: { signal?: AbortSignal }, cb: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const grant = () => {
          void cb().then(() => {
            resolve();
            next();
          });
        };
        if (!held) {
          held = true;
          queueMicrotask(grant);
          return;
        }
        const w = { grant };
        waiting.push(w);
        opts.signal?.addEventListener("abort", () => {
          waiting.splice(waiting.indexOf(w), 1);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  };
}

const state = { type: "notice" } as const;

beforeEach(() => {
  FakeEventSource.all = [];
  FakeChannel.open = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  Object.defineProperty(navigator, "locks", { value: fakeLocks(), configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

function tab() {
  const heard: LiveMessage[] = [];
  const stop = followLiveEvents((m) => heard.push(m));
  return { heard, stop };
}

describe("followLiveEvents", () => {
  it("streams in one tab and passes every message to the others", async () => {
    const a = tab();
    const b = tab();
    await vi.waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(1);
    });
    const source = FakeEventSource.all[0];
    source?.open();
    source?.push(state);
    expect(a.heard).toEqual([{ kind: "event", event: state }]);
    expect(b.heard).toEqual([{ kind: "gap" }, { kind: "event", event: state }]);
    a.stop();
    b.stop();
  });

  it("hands the stream to the next tab when the holder closes, which fetches again", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    const a = tab();
    const b = tab();
    const c = tab();
    await vi.waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(1);
    });
    now.mockReturnValue(60_000);
    b.heard.length = 0;
    c.heard.length = 0;
    a.stop();
    await vi.waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(2);
    });
    expect(FakeEventSource.all[0]?.closed).toBe(true);
    expect(b.heard).toEqual([{ kind: "gap" }]);
    expect(c.heard).toEqual([{ kind: "gap" }]);
    b.stop();
    c.stop();
  });

  it("reports a drop after the stream was open as a gap, and a failure to connect as nothing", async () => {
    const a = tab();
    await vi.waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(1);
    });
    const source = FakeEventSource.all[0];
    source?.drop();
    expect(a.heard).toEqual([]);
    source?.open();
    source?.drop();
    expect(a.heard).toEqual([{ kind: "gap" }]);
    a.stop();
  });

  it("streams in every tab where the browser has no locks", () => {
    Reflect.deleteProperty(navigator, "locks");
    const a = tab();
    const b = tab();
    expect(FakeEventSource.all.map((s) => s.url)).toEqual([
      "/api/downloads/events",
      "/api/downloads/events",
    ]);
    a.stop();
    b.stop();
    expect(FakeEventSource.all.every((s) => s.closed)).toBe(true);
  });
});
