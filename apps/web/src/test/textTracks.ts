/** A media element's `textTracks`: its children's tracks, firing whatever the test dispatches. */
function textTrackList(media: HTMLMediaElement): EventTarget {
  return Object.assign(new EventTarget(), {
    *[Symbol.iterator]() {
      for (const el of media.querySelectorAll("track")) yield el.track;
    },
  });
}

/** jsdom has no TextTrack: each `<track>` gets a plain one, listed by its media element. */
export function withTextTracks(): () => void {
  const trackDesc = Object.getOwnPropertyDescriptor(HTMLTrackElement.prototype, "track");
  const listDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "textTracks");
  const tracks = new WeakMap<HTMLTrackElement, TextTrack>();
  const lists = new WeakMap<HTMLMediaElement, EventTarget>();
  Object.defineProperty(HTMLTrackElement.prototype, "track", {
    configurable: true,
    get(this: HTMLTrackElement) {
      let t = tracks.get(this);
      if (t === undefined) {
        // An EventTarget, because Video.js listens on every track.
        t = Object.assign(new EventTarget(), {
          kind: this.kind,
          language: this.srclang,
          label: this.label,
          mode: "disabled",
        }) as unknown as TextTrack;
        tracks.set(this, t);
      }
      return t;
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "textTracks", {
    configurable: true,
    get(this: HTMLMediaElement) {
      let list = lists.get(this);
      if (list === undefined) {
        list = textTrackList(this);
        lists.set(this, list);
      }
      return list;
    },
  });
  return () => {
    if (trackDesc) Object.defineProperty(HTMLTrackElement.prototype, "track", trackDesc);
    else Reflect.deleteProperty(HTMLTrackElement.prototype, "track");
    if (listDesc) Object.defineProperty(HTMLMediaElement.prototype, "textTracks", listDesc);
  };
}
