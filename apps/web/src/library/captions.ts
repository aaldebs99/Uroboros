/**
 * Captions centred across the picture, in the player and in a tile's preview. YouTube's captions
 * (most of what yt-dlp saves) pin every cue to the left with `align:start position:0%`; their
 * line, how high they sit, is left as the file has it.
 */

/** HTMLTrackElement.LOADED: the track's cues are parsed. */
const LOADED = 2;

/** Centres the loaded cues of `track` that carry VTT positioning. */
export function centerCues(track: TextTrack): void {
  const cues = track.cues;
  if (cues === null) return;
  for (const cue of Array.from(cues)) {
    if (!("align" in cue)) continue;
    const vtt = cue as VTTCue;
    vtt.align = "center";
    vtt.position = "auto";
    vtt.size = 100;
  }
}

/**
 * Keeps every caption track of `video` centred: each as its cues load (a browser loads them only
 * once the track shows), or at once when they already have. Returns the cleanup.
 */
export function centerCaptions(video: HTMLVideoElement): () => void {
  const els = Array.from(video.querySelectorAll("track"));
  const listeners = els.map((el) => {
    const center = () => {
      centerCues(el.track);
    };
    el.addEventListener("load", center);
    if (el.readyState === LOADED) center();
    return () => {
      el.removeEventListener("load", center);
    };
  });
  return () => {
    for (const stop of listeners) stop();
  };
}
