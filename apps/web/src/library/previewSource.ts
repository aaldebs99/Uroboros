import type { LibraryItem, SubtitleTrack } from "@uroboros/contract";

import { pickSubtitle } from "./subtitlePref";

/**
 * Where a hover preview plays from (docs/library.md "Hover previews"): a file the browser plays
 * itself, or a live 480p playback session the server transcodes.
 */
export type PreviewSource = { kind: "file"; url: string } | { kind: "session" };

/**
 * What a video's preview can play, best first: the stored 480p preview once it is made; the
 * original, where this browser plays it (`playsOriginal`, from `canPlayOriginal`); and a live 480p
 * session, which any video can have. A source that fails gives way to the next.
 */
export function previewSources(
  item: Pick<LibraryItem, "previewUrl" | "streamUrl">,
  playsOriginal: boolean,
): PreviewSource[] {
  const sources: PreviewSource[] = [];
  if (item.previewUrl !== null) sources.push({ kind: "file", url: item.previewUrl });
  if (playsOriginal) sources.push({ kind: "file", url: item.streamUrl });
  sources.push({ kind: "session" });
  return sources;
}

/**
 * The subtitle track a preview shows, captions being on in previews: the remembered language as
 * the player picks it (`pickSubtitle`), else the first manual track, else the first; none without
 * tracks. Unlike the player, a preview never records a choice.
 */
export function pickPreviewSubtitle(
  tracks: readonly Pick<SubtitleTrack, "lang" | "automatic">[],
  savedLang: string | null,
): number | null {
  if (tracks.length === 0) return null;
  if (savedLang !== null) return pickSubtitle(tracks, savedLang);
  const manual = tracks.findIndex((t) => !t.automatic);
  return manual === -1 ? 0 : manual;
}
