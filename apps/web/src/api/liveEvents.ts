import { DownloadEvent } from "@uroboros/contract";

/**
 * The caller's live events (`/api/downloads/events`: download changes, and the notice and previews
 * nudges), one connection per browser. A browser allows about six HTTP/1.1 connections to one origin, so an
 * event stream in every tab would use them up with a few tabs open: the tab holding the Web Lock
 * streams and passes every message to the others over a BroadcastChannel, and when it closes the
 * next tab takes over. Without locks or channels each tab streams on its own.
 */

/** An event, or word that some may have been missed (so fetch again). */
export type LiveMessage = { kind: "event"; event: DownloadEvent } | { kind: "gap" };

const LOCK = "uroboros-live-events";
const CHANNEL = "uroboros-live-events";
/** A tab that takes the lock this soon after starting has just fetched everything itself. */
const FRESH_MS = 2000;

function parse(data: unknown): LiveMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { kind?: unknown; event?: unknown };
  if (m.kind === "gap") return { kind: "gap" };
  if (m.kind !== "event") return null;
  const event = DownloadEvent.safeParse(m.event);
  return event.success ? { kind: "event", event: event.data } : null;
}

/**
 * Follows one event stream; a drop after it was open is a gap (the browser reconnects by itself).
 * Returns what closes it.
 */
export function openStream(url: string, onMessage: (m: LiveMessage) => void): () => void {
  const source = new EventSource(url);
  let open = false;
  source.onopen = () => {
    open = true;
  };
  source.onmessage = (message: MessageEvent<string>) => {
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = DownloadEvent.safeParse(data);
    if (event.success) onMessage({ kind: "event", event: event.data });
  };
  source.onerror = () => {
    if (!open) return;
    open = false;
    onMessage({ kind: "gap" });
  };
  return () => {
    source.close();
  };
}

/** Follows the caller's own live events, shared by this browser's tabs. Returns what stops it. */
export function followLiveEvents(onMessage: (m: LiveMessage) => void): () => void {
  const url = "/api/downloads/events";
  if (typeof EventSource === "undefined") return () => undefined;
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined || typeof BroadcastChannel === "undefined") {
    return openStream(url, onMessage);
  }
  const startedAt = Date.now();
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<unknown>) => {
    const message = parse(e.data);
    if (message !== null) onMessage(message);
  };
  const stop = new AbortController();
  const holding = (): Promise<void> =>
    new Promise<void>((release) => {
      const share = (m: LiveMessage) => {
        channel.postMessage(m);
        onMessage(m);
      };
      // Taking over from a tab that closed: what happened in between was missed.
      channel.postMessage({ kind: "gap" } satisfies LiveMessage);
      if (Date.now() - startedAt > FRESH_MS) onMessage({ kind: "gap" });
      const close = openStream(url, share);
      if (stop.signal.aborted) {
        close();
        release();
        return;
      }
      stop.signal.addEventListener(
        "abort",
        () => {
          close();
          release();
        },
        { once: true },
      );
    });
  locks.request(LOCK, { signal: stop.signal }, holding).catch(() => undefined);
  return () => {
    stop.abort();
    channel.close();
  };
}
