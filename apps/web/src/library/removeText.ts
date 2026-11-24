import type { EntryOrigin } from "@uroboros/contract";

/**
 * What removing an entry does, for its confirmation: a download's file stays for others; an
 * upload's goes (after the reaper's day), unless someone it was shared with added it.
 */
export function removeDescription(origin: EntryOrigin): string {
  switch (origin) {
    case "download":
      return "It leaves your library. Others who downloaded it keep their copy.";
    case "upload":
      return "It leaves your library, and its file is deleted unless someone you shared it with added it to theirs. An upload can't be downloaded again.";
  }
}
