/** Where a transcode's files live: `.transcodes/<id>/`, one folder per attempt below it. */
export const transcodePrefix = (id: string): string => `.transcodes/${id}/`;

/** One attempt's files: `.transcodes/<id>/<attempt>/`. */
export const attemptPrefix = (id: string, attempt: number): string =>
  `${transcodePrefix(id)}${String(attempt)}/`;
