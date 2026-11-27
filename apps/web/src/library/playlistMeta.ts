import type { PlaylistSummary } from "@uroboros/contract";

/**
 * A playlist's line under its name, on its tile and its page: its kind and size, and whether it
 * keeps its videos out of the library (docs/library.md "Hiding from the library").
 */
export function playlistMeta(p: Pick<PlaylistSummary, "kind" | "count" | "hideFromLibrary">) {
  return [
    p.kind === "youtube" ? "From YouTube" : "Playlist",
    `${String(p.count)} videos`,
    ...(p.hideFromLibrary ? ["Hidden from library"] : []),
  ].join(" · ");
}
