import { fixture, type Scenario, type Step } from "@uroboros/ytdlp/testing";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { queueDownload } from "../src/downloads/dispatch.ts";
import { argsOf } from "../src/downloads/profiles.ts";
import type { FetchJob } from "../src/downloads/queues.ts";
import type { SignedIn } from "./auth.ts";
import { seededDefault } from "./downloads.ts";

/** The recorded download of the clip, plus a thumbnail beside it, after any `extra` steps. */
export async function downloadScenario(extra: Step[] = []): Promise<Scenario> {
  const transcript = JSON.parse(await fixture("download-clip.json")) as {
    stdout: string;
    stderr: string;
  };
  return {
    steps: [
      ...extra,
      { writeFile: "clip.mp4", content: "media bytes" },
      { writeFile: "clip.jpg", content: "jpeg" },
      { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
      { stdout: transcript.stdout },
      { stderr: transcript.stderr },
    ],
  };
}

/** Queues `videoId` for each user, in order, and returns the fetch job a dispatch would add. */
export async function queuedFetch(
  db: Kysely<Database>,
  videoId: string,
  users: SignedIn[],
): Promise<FetchJob> {
  const profile = await seededDefault(db);
  for (const u of users) {
    await db.transaction().execute((tx) =>
      queueDownload(tx, {
        userId: u.userId,
        requestId: null,
        extractor: "Generic",
        videoId,
        url: `http://127.0.0.1:18765/${videoId}.mp4`,
        title: videoId,
        profile,
      }),
    );
  }
  const row = await db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  return {
    fetchKey: row.fetch_key,
    extractor: "generic",
    videoId,
    url: `http://127.0.0.1:18765/${videoId}.mp4`,
    profileId: profile.id,
    profileName: profile.name,
    revision: profile.revision,
    args: argsOf(profile),
  };
}

/** The job a fetch processor is handed. */
export const fetchJob = (data: FetchJob, attemptsMade = 0) => ({
  id: data.fetchKey,
  data,
  attemptsMade,
  opts: { attempts: 3 },
});

/** Every download of `videoId`, as the fetch left it. */
export const downloadStates = (db: Kysely<Database>, videoId: string) =>
  db
    .selectFrom("downloads")
    .select(["user_id", "state", "error_kind", "attempts", "stderr_tail"])
    .where("video_id", "=", videoId)
    .execute();
