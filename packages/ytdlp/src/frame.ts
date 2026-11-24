import { resolve } from "node:path";
import { YtDlpError } from "./errors.ts";
import { DEFAULT_KILL_GRACE_MS } from "./process.ts";
import { meaningfulLine, spawnStream } from "./streamProcess.ts";

export interface FrameOptions {
  binary?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Where in the video to take the frame, in seconds. */
  atSeconds: number;
  /** The widest the picture may be; a narrower video keeps its width. Default 1280. */
  maxWidth?: number;
  /** The most bytes the picture may have. Default 10 MiB. */
  maxBytes?: number;
  killGraceMs?: number;
}

/** Network protocols only, for an input that is a URL (an S3 object). */
const URL_PROTOCOLS = ["-protocol_whitelist", "http,https,tcp,tls,crypto"];

/**
 * One frame of a video (or a URL's) as a JPEG, from ffmpeg's stdout: an uploaded video's thumbnail
 * when its person sent none (docs/uploads.md).
 */
export async function grabFrame(input: string, o: FrameOptions): Promise<Buffer> {
  const maxBytes = o.maxBytes ?? 10 * 1024 * 1024;
  const run = spawnStream({
    binary: o.binary ?? "ffmpeg",
    args: [
      "-v",
      "error",
      "-ss",
      o.atSeconds.toFixed(3),
      // An absolute path never starts with "-", so ffmpeg cannot read it as an option.
      ...(/^https?:\/\//.test(input) ? [...URL_PROTOCOLS, "-i", input] : ["-i", resolve(input)]),
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${String(o.maxWidth ?? 1280)},iw)':-2`,
      "-c:v",
      "mjpeg",
      "-q:v",
      "3",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    ...(o.env === undefined ? {} : { env: o.env }),
    ...(o.signal === undefined ? {} : { signal: o.signal }),
    killGraceMs: o.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
  });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of run.stdout) {
    size += chunk.length;
    if (size > maxBytes) {
      run.stop();
      break;
    }
    chunks.push(chunk);
  }
  const exit = await run.exited;
  if (exit.stopped) {
    if (o.signal?.aborted === true) throw new YtDlpError("cancelled", "the frame was not taken");
    throw new YtDlpError("invalid_output", "ffmpeg's frame is too large");
  }
  if (exit.code !== 0 || size === 0) {
    throw new YtDlpError(
      "invalid_output",
      `ffmpeg took no frame: ${meaningfulLine(exit.stderrTail)}`,
      {
        exitCode: exit.code,
        stderrTail: exit.stderrTail,
      },
    );
  }
  return Buffer.concat(chunks);
}
