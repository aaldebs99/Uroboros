/** `caption_segments`: a subtitle track's captions as runs of lines, for search. */
export interface CaptionSegmentsTable {
  subtitle_id: string;
  media_id: string;
  seq: number;
  start_s: number;
  end_s: number;
  text: string;
  /** Where each line begins in `text` (UTF-16 offsets). */
  line_at: number[];
  /** When each line starts, in seconds. */
  line_start: number[];
}
