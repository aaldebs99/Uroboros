import type { Download, Export, Notice } from "@uroboros/contract";

/** Fixtures for the bell: a download, a copy and a notice, each overridable. */

const T = "2026-11-24T18:00:00.000Z";

export const downloadFixture = (over: Partial<Download> = {}): Download => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000d1",
  owner: { id: "0190a3f2-7c1e-7000-8000-000000000001", displayName: "Alice" },
  url: "https://www.youtube.com/watch?v=a",
  title: "Big Buck Bunny",
  extractor: "youtube",
  videoId: "a",
  profileId: "0190a3f2-7c1e-7000-8000-0000000000a1",
  fetchKey: "fetch|youtube|a|p|r1",
  state: "running",
  progress: null,
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  attempts: 1,
  createdAt: T,
  startedAt: T,
  finishedAt: null,
  ...over,
});

export const copyFixture = (over: Partial<Export> = {}): Export => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000e1",
  entryId: "0190a3f2-7c1e-7000-8000-0000000000e2",
  title: "GTA VI at 60 FPS",
  state: "running",
  progress: 0.25,
  encoder: "libx264",
  error: null,
  sizeBytes: null,
  keptSeconds: 903.5,
  cutSeconds: 104.5,
  createdAt: T,
  fileUrl: null,
  ...over,
});

export const noticeFixture = (over: Partial<Notice> = {}): Notice => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000f1",
  kind: "downloads",
  title: "Ready: Big Buck Bunny",
  body: null,
  path: "/library/0190a3f2-7c1e-7000-8000-0000000000e2",
  createdAt: T,
  read: false,
  ...over,
});
