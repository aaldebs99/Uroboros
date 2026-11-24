import type { StoredPart } from "./store.ts";

/** Refuses parts that are not exactly 1..N: a gap would leave a hole in the file. */
export function checkParts(parts: StoredPart[]): StoredPart[] {
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  sorted.forEach((p, i) => {
    if (p.n !== i + 1) throw new Error(`part ${String(i + 1)} is missing`);
  });
  if (sorted.length === 0) throw new Error("an upload needs at least one part");
  return sorted;
}
