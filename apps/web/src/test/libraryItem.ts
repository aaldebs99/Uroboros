import type { LibraryItem } from "@uroboros/contract";

/** A downloaded video in the person's own library, for the watch page's tests. */

export const ITEM_ID = "0190a3f2-7c1e-7000-8000-0000000000c1";
const ID = ITEM_ID;

export const itemFixture: LibraryItem = {
  id: ID,
  mediaId: "0190a3f2-7c1e-7000-8000-0000000000c2",
  title: "Big Buck Bunny",
  channel: "Blender",
  uploadDate: "2008-05-20",
  duration: 596,
  thumbnailUrl: null,
  previewUrl: null,
  profileName: "Best up to 1080p (MP4)",
  origin: "download",
  sizeBytes: 1024,
  container: "mp4",
  addedAt: "2026-11-22T10:00:00.000Z",
  progress: { position: 42, duration: 596, watched: false },
  tags: ["movies"],
  kept: false,
  subscription: null,
  channelKey: "a2V5",
  description: "A large rabbit deals with three tiny bullies. ".repeat(20),
  chapters: [
    { start: 0, end: 60, title: "Opening" },
    { start: 60, end: 596, title: "The chase" },
  ],
  skipSegments: [],
  skipSegmentsRefetchable: false,
  subtitles: [
    {
      id: "0190a3f2-7c1e-7000-8000-0000000000c3",
      lang: "en",
      name: null,
      automatic: false,
      url: `/api/library/${ID}/subtitles/x`,
    },
  ],
  streamUrl: `/api/library/${ID}/stream`,
  videoCodec: "h264",
  audioCodec: "aac",
  playbackUrl: `/api/library/${ID}/playback`,
  videoCodecs: null,
  audioCodecs: null,
  width: null,
  height: null,
  qualities: [],
  webpageUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  sources: [],
  playlists: [],
  sharedBy: null,
  editable: false,
};
