import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaStore } from "../storage/index.ts";
import { TRANSCODE } from "./settings.ts";

interface Entry {
  duration: string;
  uri: string;
}

const SEGMENT = /^seg-\d{5}\.m4s$/;

/** The segments ffmpeg's playlist lists so far, in order (a half-written last line is skipped). */
function listed(text: string): Entry[] {
  const out: Entry[] = [];
  let duration: string | null = null;
  for (const line of text.split("\n").map((l) => l.trim())) {
    const extinf = /^#EXTINF:([\d.]+),?/.exec(line);
    if (extinf !== null) duration = extinf[1] ?? null;
    else if (SEGMENT.test(line) && duration !== null) {
      out.push({ duration, uri: line });
      duration = null;
    }
  }
  return out;
}

/** A playlist naming only `entries` (all uploaded), ended once the copy is done. */
function playlistOf(entries: Entry[], targetDuration: number, done: boolean): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${String(targetDuration)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    '#EXT-X-MAP:URI="init.mp4"',
    ...entries.flatMap((e) => [`#EXTINF:${e.duration},`, e.uri]),
    ...(done ? ["#EXT-X-ENDLIST"] : []),
    "",
  ].join("\n");
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Copies a running ffmpeg's output to `prefix` in the order a player may ask for it: `init.mp4`,
 * then each segment ffmpeg's playlist lists, then a playlist naming only what is stored. `sync`
 * returns how many segments are stored.
 */
export function createUploader(store: MediaStore, prefix: string, type: string) {
  const uploaded = new Set<string>();
  let entries: Entry[] = [];
  return {
    async sync(dir: string, done = false): Promise<number> {
      const source = join(dir, "index.m3u8");
      if (!(await exists(source))) return 0;
      const fresh = listed(await readFile(source, "utf8")).slice(entries.length);
      if (fresh.length > 0 && !uploaded.has("init.mp4")) {
        await store.put(`${prefix}init.mp4`, join(dir, "init.mp4"), type);
        uploaded.add("init.mp4");
      }
      for (const e of fresh) {
        await store.put(`${prefix}${e.uri}`, join(dir, e.uri), type);
        uploaded.add(e.uri);
        entries = [...entries, e];
      }
      if (fresh.length > 0 || done) {
        // Copies with a copied video have keyframes where the source had them, so their target
        // duration comes from the segments; encoded ones never pass a segment and a frame.
        const longest = Math.ceil(Math.max(0, ...entries.map((e) => Number(e.duration))));
        const target = Math.max(TRANSCODE.segmentSeconds + 1, longest);
        const snapshot = join(dir, ".uploaded.m3u8");
        await writeFile(snapshot, playlistOf(entries, target, done));
        await store.put(`${prefix}index.m3u8`, snapshot, "application/vnd.apple.mpegurl");
      }
      return entries.length;
    },
  };
}
