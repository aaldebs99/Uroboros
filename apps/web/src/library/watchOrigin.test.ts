import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { keepTrail, placeName, watchOrigin } from "./watchOrigin";

const VIDEO = "/library/0190a3f2-7c1e-7000-8000-000000000200";
const NEXT = "/library/0190a3f2-7c1e-7000-8000-000000000201";

/** A kept history that starts at `first` and was pushed through `then`. */
function trail(first: string, ...then: string[]) {
  const history = keepTrail(createMemoryHistory({ initialEntries: [first] }));
  for (const path of then) history.push(path);
  return history;
}

describe("a watch page's way back (watchOrigin)", () => {
  it("is the page the video was opened from, one step back", () => {
    expect(watchOrigin(trail("/downloads", VIDEO))).toEqual({
      href: "/downloads",
      label: "Downloads",
      steps: 1,
    });
  });

  it("goes past the videos played since, and keeps the page's search", () => {
    expect(watchOrigin(trail("/?q=cats&tag=music", VIDEO, NEXT, VIDEO))).toEqual({
      href: "/?q=cats&tag=music",
      label: "Library",
      steps: 3,
    });
  });

  it("is the page an entry was replaced by, not the one it held before", () => {
    const history = trail("/library/channels", "/library/playlists");
    history.back();
    history.push("/downloads");
    history.push(VIDEO);
    expect(watchOrigin(history)).toMatchObject({ href: "/downloads", steps: 1 });
  });

  it("is the Library for a watch page opened from outside, or with nothing kept", () => {
    const library = { href: "/", label: "Library", steps: null };
    expect(watchOrigin(trail(VIDEO))).toEqual(library);
    expect(watchOrigin(trail(VIDEO, NEXT))).toEqual(library);
    expect(watchOrigin(createMemoryHistory({ initialEntries: ["/downloads", VIDEO] }))).toEqual(
      library,
    );
  });
});

describe("placeName", () => {
  it.each([
    ["/", "Library"],
    ["/library/audio", "Audio"],
    ["/library/channels", "Channels"],
    ["/library/channels/yt%3AUC123", "Channel"],
    ["/library/playlists", "Playlists"],
    ["/library/playlists/0190a3f2-7c1e-7000-8000-000000000300", "Playlist"],
    ["/subscriptions", "Subscriptions"],
    ["/subscriptions/new", "New subscription"],
    ["/subscriptions/0190a3f2-7c1e-7000-8000-000000000400", "Subscription"],
    ["/shared", "Shared"],
    ["/shared/by-me", "Shared"],
    ["/shared/0190a3f2-7c1e-7000-8000-000000000500", "Shared playlist"],
    ["/settings/sponsorblock", "Settings"],
    ["/account", "Back"],
  ])("calls %s %s", (pathname, name) => {
    expect(placeName(pathname)).toBe(name);
  });
});
