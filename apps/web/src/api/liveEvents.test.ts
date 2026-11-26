import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followLiveEvents, openStream, type LiveMessage } from "./liveEvents";

/** A stand-in EventSource the test can open, push through and drop. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState: number = FakeEventSource.CONNECTING;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  /** A drop the browser reconnects by itself. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }
  /** A refused (re)connection: the browser gives the stream up for good. */
  refuse() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
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
    await waitFor(() => {
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
    await waitFor(() => {
      expect(FakeEventSource.all).toHaveLength(1);
    });
    now.mockReturnValue(60_000);
    b.heard.length = 0;
    c.heard.length = 0;
    a.stop();
    await waitFor(() => {
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
    await waitFor(() => {
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

describe("openStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const follow = () => {
    const heard: LiveMessage[] = [];
    const close = openStream("/api/downloads/events", (m) => heard.push(m));
    return { heard, close, latest: () => FakeEventSource.all.at(-1) };
  };

  it("opens a new stream after a growing pause when the browser gives one up, and calls it a gap", () => {
    vi.useFakeTimers();
    const s = follow();
    s.latest()?.open();
    s.latest()?.refuse();
    expect(s.heard).toEqual([{ kind: "gap" }]);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.all).toHaveLength(2);
    // Refused again before it opened: nothing more was missed, and the next pause is longer.
    s.latest()?.refuse();
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.all).toHaveLength(3);
    s.latest()?.open();
    expect(s.heard).toEqual([{ kind: "gap" }, { kind: "gap" }]);
    // Once open again, the pause starts over.
    s.latest()?.refuse();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.all).toHaveLength(4);
    s.close();
  });

  it("waits at most 30 s between attempts", () => {
    vi.useFakeTimers();
    const s = follow();
    for (let i = 0; i < 8; i++) {
      s.latest()?.refuse();
      vi.advanceTimersByTime(60_000);
    }
    const before = FakeEventSource.all.length;
    s.latest()?.refuse();
    vi.advanceTimersByTime(29_999);
    expect(FakeEventSource.all).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.all).toHaveLength(before + 1);
    s.close();
  });

  it("leaves a drop the browser reconnects itself to the browser", () => {
    vi.useFakeTimers();
    const s = follow();
    s.latest()?.open();
    s.latest()?.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.all).toHaveLength(1);
    // The browser's own reconnect is no new gap: the drop already was one.
    s.latest()?.open();
    expect(s.heard).toEqual([{ kind: "gap" }]);
    s.close();
  });

  it("opens nothing more once closed during a pause", () => {
    vi.useFakeTimers();
    const s = follow();
    s.latest()?.refuse();
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.all).toHaveLength(1);
    expect(FakeEventSource.all[0]?.closed).toBe(true);
  });
});
