import { z } from "zod";
import { num, str } from "./lenient.ts";

/**
 * yt-dlp reports progress through `--progress-template` and the finished files through
 * `--print after_move:`, both as tab-separated lines behind a marker, with every value JSON
 * encoded by the template's `j` conversion (so a value never contains a raw tab). Download
 * progress goes to stdout and postprocessor progress to stderr, so both streams are scanned.
 */
export const MARKER = "[uroboros]";

const DOWNLOAD_TEMPLATE = `download:${MARKER}\tdownload\t%(info.id)j\t%(progress)j`;
const POSTPROCESS_TEMPLATE = `postprocess:${MARKER}\tpostprocess\t%(info.id)j\t%(progress)j`;
const FILE_PRINT = `after_move:${MARKER}\tfile\t%(id)j\t%(filepath)j\t%(__infojson_filename)j`;

/** The arguments that make yt-dlp emit the lines `parseMarkedLine` reads. */
export const REPORTING_ARGS: readonly string[] = [
  "--newline",
  "--progress",
  "--progress-template",
  DOWNLOAD_TEMPLATE,
  "--progress-template",
  POSTPROCESS_TEMPLATE,
  "--print",
  FILE_PRINT,
];

export type ProgressPhase = "downloading" | "merging" | "postprocessing";
export type ProgressState = "started" | "running" | "finished" | "error";

export interface ProgressEvent {
  phase: ProgressPhase;
  state: ProgressState;
  /** The video the event is about; null when yt-dlp did not say. */
  videoId: string | null;
  /** The file being written (downloading only). */
  filename: string | null;
  downloadedBytes: number | null;
  /** The exact size when known, else yt-dlp's estimate (see `totalIsEstimate`). */
  totalBytes: number | null;
  totalIsEstimate: boolean;
  /** Bytes per second. */
  speed: number | null;
  /** Seconds left. */
  eta: number | null;
  /** Seconds since this file started. */
  elapsed: number | null;
  /** The fragment being fetched, for fragmented (HLS, DASH) downloads. */
  fragmentIndex: number | null;
  fragmentCount: number | null;
  /** The postprocessor's name (`Merger`, `FFmpegExtractAudio`, ...), for the other phases. */
  postprocessor: string | null;
}

export interface FinishedFile {
  videoId: string | null;
  /** Absolute path of the final file, after every postprocessor and the move. */
  path: string;
  /** Where the `.info.json` went, as yt-dlp reported it (relative to its working directory). */
  infoJsonPath: string | null;
}

export type MarkedLine =
  | { type: "progress"; event: ProgressEvent }
  | { type: "file"; file: FinishedFile };

const DownloadProgress = z.object({
  status: str,
  filename: str,
  downloaded_bytes: num,
  total_bytes: num,
  total_bytes_estimate: num,
  speed: num,
  eta: num,
  elapsed: num,
  fragment_index: num,
  fragment_count: num,
});

const PostprocessProgress = z.object({ status: str, postprocessor: str });

const EMPTY = {
  filename: null,
  downloadedBytes: null,
  totalBytes: null,
  totalIsEstimate: false,
  speed: null,
  eta: null,
  elapsed: null,
  fragmentIndex: null,
  fragmentCount: null,
  postprocessor: null,
} as const;

/** yt-dlp writes "NA" for a field the template could not fill. */
function value(json: string | undefined): unknown {
  if (json === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === "NA" ? null : parsed;
  } catch {
    return null;
  }
}

function idOf(json: string | undefined): string | null {
  const v = value(json);
  return typeof v === "string" ? v : null;
}

function downloadState(status: string | null): ProgressState {
  if (status === "finished") return "finished";
  if (status === "error") return "error";
  return "running";
}

function postprocessState(status: string | null): ProgressState {
  if (status === "started") return "started";
  if (status === "finished") return "finished";
  return "running";
}

function downloadEvent(videoId: string | null, progress: unknown): ProgressEvent | null {
  const parsed = DownloadProgress.safeParse(progress);
  if (!parsed.success) return null;
  const p = parsed.data;
  return {
    ...EMPTY,
    phase: "downloading",
    state: downloadState(p.status),
    videoId,
    filename: p.filename,
    downloadedBytes: p.downloaded_bytes,
    totalBytes: p.total_bytes ?? p.total_bytes_estimate,
    totalIsEstimate: p.total_bytes === null && p.total_bytes_estimate !== null,
    speed: p.speed,
    eta: p.eta,
    elapsed: p.elapsed,
    fragmentIndex: p.fragment_index,
    fragmentCount: p.fragment_count,
  };
}

function postprocessEvent(videoId: string | null, progress: unknown): ProgressEvent | null {
  const parsed = PostprocessProgress.safeParse(progress);
  if (!parsed.success) return null;
  const { status, postprocessor } = parsed.data;
  return {
    ...EMPTY,
    phase: postprocessor === "Merger" ? "merging" : "postprocessing",
    state: postprocessState(status),
    videoId,
    postprocessor,
  };
}

function fileLine(fields: readonly string[]): MarkedLine | null {
  const path = value(fields[2]);
  if (typeof path !== "string") return null;
  const info = value(fields[3]);
  return {
    type: "file",
    file: { videoId: idOf(fields[1]), path, infoJsonPath: typeof info === "string" ? info : null },
  };
}

/** Parses one output line; null for anything that is not a well-formed marked line. */
export function parseMarkedLine(line: string): MarkedLine | null {
  if (!line.startsWith(`${MARKER}\t`)) return null;
  const fields = line.slice(MARKER.length + 1).split("\t");
  const [kind, id, payload] = fields;
  let event: ProgressEvent | null = null;
  if (kind === "download") event = downloadEvent(idOf(id), value(payload));
  else if (kind === "postprocess") event = postprocessEvent(idOf(id), value(payload));
  else if (kind === "file") return fileLine(fields);
  return event === null ? null : { type: "progress", event };
}
