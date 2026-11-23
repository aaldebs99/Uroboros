/**
 * The id of the fetch shared by everyone asking for one video in one profile revision; it is also
 * the BullMQ job id, so concurrent requests attach to one job. BullMQ refuses `:` in job ids, so
 * the parts are joined with `|`, each URI-encoded (which encodes any `|` inside a part).
 */
export function fetchKey(
  extractor: string,
  videoId: string,
  profileId: string,
  revision: string,
): string {
  return ["fetch", extractor.toLowerCase(), videoId, profileId, revision]
    .map(encodeURIComponent)
    .join("|");
}

export const probeJobId = (requestId: string): string => `probe|${requestId}`;
