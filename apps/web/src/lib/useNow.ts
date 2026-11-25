import { useEffect, useState } from "react";

/**
 * The time, read again every `everyMs`, so what counts down or runs out on screen (a preview's day
 * to be picked from) moves on while the page sits open.
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}
