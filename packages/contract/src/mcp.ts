import { z } from "@hono/zod-openapi";

/** Where the MCP server answers (docs/mcp.md): only API tokens with the `mcp` scope reach it. */
export const MCP_PATH = "/api/mcp";

/** The most transcript lines one read returns. */
export const MAX_TRANSCRIPT_LINES = 1000;

/** One subtitle track of a video; `indexed` once its captions have been read for search. */
export const TranscriptTrack = z.object({
  lang: z.string(),
  automatic: z.boolean(),
  indexed: z.boolean(),
});
export type TranscriptTrack = z.infer<typeof TranscriptTrack>;

/** One caption line and when it starts, in seconds. */
export const TranscriptLine = z.object({ start: z.number(), text: z.string() });
export type TranscriptLine = z.infer<typeof TranscriptLine>;

/**
 * A page of a video's transcript from one track (`track` null when none matching was read), every
 * track it has, and where the next page starts (`nextFromSeconds`, null at the end).
 */
export const Transcript = z.object({
  entryId: z.uuid(),
  track: TranscriptTrack.nullable(),
  tracks: z.array(TranscriptTrack),
  lines: z.array(TranscriptLine),
  nextFromSeconds: z.number().nullable(),
});
export type Transcript = z.infer<typeof Transcript>;
