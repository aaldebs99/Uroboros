import { checkEncoder, type Pipeline } from "@uroboros/ytdlp";
import type { Logger } from "pino";

/**
 * Which pipeline a run uses (docs/transcoding.md). A replica's `UROBOROS_TRANSCODE_HWACCEL` names
 * its GPU; the startup self-test decides whether that GPU is used at all, and a run that fails
 * before its first fragment marks its pipeline as failed for that kind of source on this replica,
 * so the next run of such a source starts with the next pipeline in the chain.
 */

export type HwAccel = "none" | "nvenc" | "vaapi";
/** The encoder a session reports (and the status line shows). */
export type Encoder = "libx264" | "nvenc" | "vaapi";

const CHAINS: Record<HwAccel, Pipeline[]> = {
  none: ["cpu"],
  nvenc: ["nvenc", "nvenc-sw", "cpu"],
  vaapi: ["vaapi", "vaapi-sw", "cpu"],
};

/** The pipelines to try, best first. */
export function pipelinesFor(hwaccel: HwAccel, gpuWorks: boolean): Pipeline[] {
  return gpuWorks ? CHAINS[hwaccel] : CHAINS.none;
}

/** What decides whether a GPU decodes a source: its codec and pixel format. */
export function sourceKey(s: { codec: string | null; pixFmt: string | null }): string {
  return `${s.codec ?? "?"}/${s.pixFmt ?? "?"}`;
}

/** Pipelines that failed on a kind of source, remembered for this process's life. */
export class PipelineMemo {
  readonly #failed = new Set<string>();

  failed(pipeline: Pipeline, key: string): boolean {
    return this.#failed.has(`${pipeline} ${key}`);
  }

  markFailed(pipeline: Pipeline, key: string): void {
    this.#failed.add(`${pipeline} ${key}`);
  }
}

/** The first pipeline of the chain that has not failed on this kind of source; the CPU last. */
export function choosePipeline(
  chain: readonly Pipeline[],
  memo: PipelineMemo,
  key: string,
): Pipeline {
  return chain.find((p) => p === "cpu" || !memo.failed(p, key)) ?? "cpu";
}

export function encoderOf(pipeline: Pipeline): Encoder {
  if (pipeline.startsWith("nvenc")) return "nvenc";
  if (pipeline.startsWith("vaapi")) return "vaapi";
  return "libx264";
}

export interface SelfTestOptions {
  hwaccel: HwAccel;
  vaapiDevice: string;
  ffmpeg: string;
  env?: Readonly<Record<string, string>>;
  logger: Logger;
}

/**
 * Tries the replica's GPU once at startup with a second of generated video. True when there is no
 * GPU to test or it encodes; false (and a warning naming why) sends every run to the CPU.
 */
export async function selfTest(o: SelfTestOptions): Promise<boolean> {
  if (o.hwaccel === "none") {
    o.logger.info({ hwaccel: o.hwaccel }, "transcoding on the CPU");
    return true;
  }
  const result = await checkEncoder({
    binary: o.ffmpeg,
    pipeline: o.hwaccel,
    vaapiDevice: o.vaapiDevice,
    ...(o.env === undefined ? {} : { env: o.env }),
  });
  if (result.ok) {
    o.logger.info({ hwaccel: o.hwaccel }, "transcoding on the GPU");
    return true;
  }
  o.logger.warn(
    { hwaccel: o.hwaccel, error: result.error },
    "the GPU can't encode; transcoding on the CPU instead",
  );
  return false;
}
