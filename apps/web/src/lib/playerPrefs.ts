/** The player's volume and mute, remembered in this browser across videos and visits. */
export interface VolumePref {
  /** 0 to 1, as `HTMLMediaElement.volume`. */
  volume: number;
  muted: boolean;
}

export const VOLUME_KEY = "uroboros-player-volume";

function isVolumePref(value: unknown): value is VolumePref {
  if (typeof value !== "object" || value === null) return false;
  const { volume, muted } = value as Record<string, unknown>;
  return typeof volume === "number" && volume >= 0 && volume <= 1 && typeof muted === "boolean";
}

/** The saved volume, or `null` when there is none, it is junk, or storage is unavailable. */
export function readVolume(): VolumePref | null {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isVolumePref(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeVolume(pref: VolumePref): void {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(pref));
  } catch {
    // Private windows and blocked storage: the volume just won't outlive the page.
  }
}

/** The language of the subtitles the viewer last turned on; absent while they are off (the default). */
export const SUBTITLES_KEY = "uroboros-player-subtitles";

/** The saved subtitle language, or `null` for off: nothing saved, or storage is unavailable. */
export function readSubtitleLang(): string | null {
  try {
    return localStorage.getItem(SUBTITLES_KEY);
  } catch {
    return null;
  }
}

/** Saves the language now showing, or `null` when the viewer turned subtitles off. */
export function storeSubtitleLang(lang: string | null): void {
  try {
    if (lang === null) localStorage.removeItem(SUBTITLES_KEY);
    else localStorage.setItem(SUBTITLES_KEY, lang);
  } catch {
    // As with the volume: the choice just won't outlive the page.
  }
}
