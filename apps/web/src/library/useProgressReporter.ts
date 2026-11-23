import { useEffect, useMemo, useRef } from "react";

/** How often playback reports where the person is, at most. */
export const REPORT_EVERY_MS = 10_000;

/**
 * Throttled progress reports: the first time update, then at most every 10 s, and at once on
 * pause and at the end. A failed report is dropped; the next one carries the newer position.
 */
export function useProgressReporter(report: (position: number, duration: number) => Promise<void>) {
  const last = useRef<number | null>(null);
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);
  return useMemo(() => {
    const send = (position: number, duration: number) => {
      if (!(duration > 0)) return;
      last.current = Date.now();
      reportRef.current(position, duration).catch(() => undefined);
    };
    return {
      onTime(position: number, duration: number) {
        if (last.current !== null && Date.now() - last.current < REPORT_EVERY_MS) return;
        send(position, duration);
      },
      onPause: send,
      onEnded: send,
    };
  }, []);
}
